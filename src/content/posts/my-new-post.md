---
title: 推理优化路线task2
description: 
date: 2026-08-25
tags: [FlashAttention模拟]
series: 
draft: true
---



# 一级标题

[链接](https://astro.build)。
## 随着上下文长度增加，KV cache大小一定增加
KV cache 本质上是**在解码阶段保存历史 token 的 Key 和 Value**。每生成一个新 token，模型都要把这一 token 在每一层、每一个 KV 头上的 K/V 追加进缓存里，所以它的增长不是“偶尔增加一点”，而是随着上下文长度持续线性增长。

更具体地说，标准自回归推理里，缓存大小通常可以写成：
$$
\text{KV Cache Bytes} \approx 2 \times L \times B \times H_{kv} \times D \times S
$$

其中：
- $L$ 是层数
- $B$ 是 batch size
- $H_{kv}$ 是 KV 头数
- $D$ 是 head dim
- $S$ 是上下文长度
- 前面的 $2$ 表示同时存 K 和 V
### 示例代码
```python
def kv_cache_bytes(seq_len, num_layers, num_kv_heads, head_dim, batch_size=1, dtype_bytes=2):
    return 2 * seq_len * num_layers * num_kv_heads * head_dim * batch_size * dtype_bytes

examples = [(1024, 32, 32, 128), (2048, 32, 32, 128), (4096, 32, 32, 128)]
for seq_len, layers, kv_heads, head_dim in examples:
    size_gb = kv_cache_bytes(seq_len, layers, kv_heads, head_dim) / 1e9
    print(f"seq_len={seq_len:4d} -> KV cache ≈ {size_gb:5.2f} GB")
```
`seq_len=1024 -> KV cache ≈  0.54 GB`
`seq_len=2048 -> KV cache ≈  1.07 GB`
`seq_len=4096 -> KV cache ≈  2.15 GB`

## MQA、GQA通过减少KV头数来减少KV cache大小
- **MHA (Multi-Head Attention)**：每个 query head 都有自己对应的一组 K/V，缓存压力最大。
- **MQA (Multi-Query Attention)**：多个 query head 共享同一组 K/V，KV cache 立刻变小。
- **GQA (Grouped-Query Attention)**：介于 MHA 和 MQA 之间，把 query heads 分组共享 K/V，在显存和表达能力之间做折中。
### 示例代码
```python
def kv_cache_gb(seq_len, num_layers, num_kv_heads, head_dim, batch_size=1, dtype_bytes=2):
    return kv_cache_bytes(seq_len, num_layers, num_kv_heads, head_dim, batch_size, dtype_bytes) / 1e9

seq_len = 4096
num_layers = 32
head_dim = 128
for name, kv_heads in [("MHA", 32), ("GQA", 8), ("MQA", 1)]:
    print(f"{name:>3s}: kv_heads={kv_heads:2d}, KV cache ≈ {kv_cache_gb(seq_len, num_layers, kv_heads, head_dim):5.2f} GB")
```
`MHA: kv_heads=32, KV cache ≈  2.15 GB`
`GQA: kv_heads= 8, KV cache ≈  0.54 GB`
`MQA: kv_heads= 1, KV cache ≈  0.07 GB`

## PageAttention和MLA分别解决的是什么问题？
- **PagedAttention** 主要解决的是 **缓存分配和访问组织** 问题。
  - 它把 KV cache 按页组织，避免长序列和多请求场景里出现连续大块显存分配困难。
  - 它的重点不是把 K/V 表示本身压缩掉，而是让缓存的存储、搬运和复用更稳定。

- **MLA (Multi-Head Latent Attention)** 主要解决的是 **表示压缩** 问题。
  - 它把原本需要长期保存的 KV 表示压到更低维的潜变量空间里。
  - 这样做的核心收益是直接降低每个 token 需要保留的缓存体积。

可以把它们理解成两种不同方向的优化：
- PagedAttention 是在优化“怎么管 cache”。
- MLA 是在优化“cache 本身有多大”。

前者偏系统实现，后者偏表示结构。两者都在缓解长上下文下的显存压力，但切入点不同。

# FlashAttention模拟
## 核心理论与 Online Softmax
> ### 标准 Softmax 的痛点
> 1. 求每一行的最大值 $m = \max(x)$ (防溢出)。
> 2. 求每一行的指数和 $l = \sum e^{x - m}$。
> 3. 求最终结果 $y_i = \frac{e^{x_i - m}}{l}$。
> 这意味着在算出所有 $x$ 之前，你无法算出 $m$ 和 $l$，因此必须把所有的 $x$ 先存下来。在 Attention 中，$x$ 就是那个大规模的 $S = QK^T$ 矩阵！这也是 FlashAttention 必须引入分块计算的根本原因。

> ### Online Softmax 的机制
> 我们可以在只看到**部分数据**时，持续更新一个局部的最大值 $m_{new}$ 和局部的指数和 $l_{new}$。
> 当新来一个分块 (Block) 时，如果新块的最大值更大，我们可以用一个数学技巧，把之前算好的部分“修正”过来，而不需要重新算前面的块！
> 
> **更新公式：**
> - 新的局部最大值：$m_{new} = \max(m_{old}, m_{block})$
> - 修正旧的指数和：$l_{new} = l_{old} \cdot e^{m_{old} - m_{new}} + l_{block} \cdot e^{m_{block} - m_{new}}$
> - 修正旧的输出结果（乘积累加）：$O_{new} = O_{old} \cdot \frac{l_{old} \cdot e^{m_{old} - m_{new}}}{l_{new}} + \frac{e^{S_{block} - m_{new}} \cdot V_{block}}{l_{new}}$
## Flash Attention 分块机制原理
由于标准的 Attention 需要 $O(N^2)$ 的显存来存储巨大的 Attention Score 矩阵 $S = QK^T$，当上下文变长时必定 OOM。Flash Attention 巧妙地在**序列维度**上对 Q, K, V 进行分块（Tiling）。通过外层循环遍历 Q 块，内层循环遍历 K 和 V 块，我们可以在保持数学上完全等价的前提下，将显存消耗降到 $O(N)$。
## 代码实现框架
核心是三层嵌套的循环（或者是二维 Grid）。对于当前处理的一小块 $Q_{block}$，在内层遍历所有 $K_{block}$ 时，动态地更新局部最大值 $m$ 和局部指数和 $l$。这是在纯 PyTorch 中使用 `for` 循环来模拟底层 C++ 内存块调度的绝佳方式。

## 工业界的演进 —— FlashAttention V1 vs V2 vs V3

了解了基础的 Online Softmax 和分块机制后，我们再看业界是如何一步步把 GPU 硬件性能榨出来的。这一段是理解 FlashAttention 演进脉络的核心，也是高阶面试里经常会被追问的部分。

> **FlashAttention-1 (2022)：打破显存墙**
> - **核心创新**：通过 Tiling（分块）和 Recomputation（重计算），把空间复杂度从 $O(N^2)$ 降到 $O(N)$。
> - **局限**：Thread Block 内部的 Non-Matmul 计算偏多，且在短 Batch / 长序列场景下 Occupancy 不高。

> **FlashAttention-2 (2023)：算法级优化与多维并行**
> - **核心创新 1：减少 Non-Matmul FLOPs**。调整内部循环和归一化逻辑，减少每步不必要的标量运算，把更多算力留给 Tensor Core。
> - **核心创新 2：Sequence Parallelism（序列级并行）**。把序列长度维度也纳入切块调度，让长文本推理时 GPU 更容易保持满载。

> **FlashAttention-3 (2024)：绑定 Hopper (H100) 的极限压榨**
> - **核心创新 1：WGMMA 异步计算**。利用 Warp Group 级指令，让 Tensor Core 在后台异步执行。
> - **核心创新 2：TMA（Tensor Memory Accelerator）**。使用硬件级搬运器把数据从全局显存搬到共享内存，释放搬运线程。
> - **核心创新 3：2-Stage to Ping-Pong Pipeline**。通过更高效的软件流水线掩盖访存延迟，实现计算与访存的重叠。

> **FlashAttention-4：CuTeDSL 与 Blackwell 方向**
> - **核心方向**：继续沿着工程化优化推进，把更底层的 kernel 构建、内存调度和流水线协同做得更细。
> - **直观理解**：相比 V1/V2/V3 更强调“代码生成 + kernel 组织”的一体化优化，而不是只停留在数学公式层面的改写。
> - **教学定位**：这一版可以理解为 FlashAttention 工程演进的最新补充，读者只要知道它是继续面向新 GPU 架构演化即可。
### 思考时间
在 V1 的算法中，我们在内层循环每次更新块时，都会执行 `v_block = v_block * scale1 + v_i * scale2`。这个标量乘法是跑在 CUDA Core 上的，速度很慢。 
如果我们要朝着 FlashAttention-2 的方向优化上面的纯 PyTorch 模拟代码，应该怎么在数学上修改这段 `Online Softmax`，使得 `v_block` 的缩放只在整个循环结束时发生一次？

## 通过代码学
朴素 attention：$S = QKᵀ（N×N）$→ $P = softmax(S)$ → $O = PV$，需要 `O(N²)` 内存。
FlashAttention 的关键观察：softmax 只关心三件事：
* 每行最大值 $m_i$（用于数值稳定）
* 每行 $exp-sum l_i$（归一化分母）
* 加权输出 $o_i = Σ exp(s_ij - m_i) · v_j$
这三者都可以增量更新，所以可以分块累加。

```python
import torch
import math

def flash_attention_forward_sim(q, k, v, block_size=2):
    seq_len, dim = q.shape

    out = torch.zeros_like(q)
    m   = torch.full((seq_len,), float("-inf"),
                     dtype=q.dtype, device=q.device)
    l   = torch.zeros(seq_len, dtype=q.dtype, device=q.device)

    scale = 1.0 / math.sqrt(dim)

    for i in range(0, seq_len, block_size):
        q_block = q[i:i+block_size] * scale
        m_i   = m[i:i+block_size]
        l_i   = l[i:i+block_size]
        out_i = out[i:i+block_size]

        for j in range(0, seq_len, block_size):
            k_block = k[j:j+block_size]
            v_block = v[j:j+block_size]

            S_ij = q_block @ k_block.T

            m_block = S_ij.max(dim=-1).values
            m_new   = torch.maximum(m_i, m_block)

            P_ij = torch.exp(S_ij - m_new.unsqueeze(-1))

            l_block = P_ij.sum(dim=-1)
            l_new   = torch.exp(m_i - m_new) * l_i + l_block

            out_i = torch.exp(m_i - m_new).unsqueeze(-1) * out_i + P_ij @ v_block

            m_i = m_new
            l_i = l_new

        out[i:i+block_size] = out_i
        m[i:i+block_size]   = m_i
        l[i:i+block_size]   = l_i

    return out / l.unsqueeze(-1)


def naive_attention(q, k, v):
    scale = 1.0 / math.sqrt(q.shape[-1])
    S = q @ k.T * scale
    return torch.softmax(S, dim=-1) @ v


# 自检
torch.manual_seed(0)
q = torch.randn(8, 4)
k = torch.randn(8, 4)
v = torch.randn(8, 4)

ref = naive_attention(q, k, v)
for bs in [1, 2, 4, 8]:
    out = flash_attention_forward_sim(q, k, v, block_size=bs)
    print(f"block_size={bs}: max abs diff = {(ref - out).abs().max().item():.2e}")
```
```python
# 测试你的实现
def test_flash_attention_sim():
    try:
        import math

        def run_case(seq_len, dim, block_size, seed):
            torch.manual_seed(seed)
            q = torch.randn(seq_len, dim)
            k = torch.randn(seq_len, dim)
            v = torch.randn(seq_len, dim)

            scale = 1.0 / math.sqrt(dim)
            scores = (q @ k.transpose(-2, -1)) * scale
            attn = torch.nn.functional.softmax(scores, dim=-1)
            out_ref = attn @ v

            out_sim = flash_attention_forward_sim(q, k, v, block_size=block_size)
            diff = torch.max(torch.abs(out_ref - out_sim))
            print(f"[seq={seq_len}, dim={dim}, block={block_size}] 最大误差: {diff.item():.6e}")
            assert diff < 1e-5, f"计算结果与标准 Attention 不一致！(seq={seq_len}, dim={dim}, block={block_size})"

        run_case(seq_len=8, dim=4, block_size=2, seed=42)
        run_case(seq_len=5, dim=3, block_size=3, seed=7)
        run_case(seq_len=3, dim=2, block_size=1, seed=123)

        print("✅ Online Softmax 与分块计算逻辑正确！")
        print("\n FlashAttention 分块计算逻辑验证通过。")

    except NotImplementedError:
        print("请先完成 TODO 部分的代码！")
        raise
    except (AttributeError, NameError, TypeError, ValueError, AssertionError, RuntimeError) as e:
        if isinstance(e, AttributeError):
            print("代码未完成，无法找到必要的属性")
        elif isinstance(e, NameError):
            print("代码可能未完成，导致了变量未定义")
        elif isinstance(e, TypeError):
            print("代码可能未完成，导致了操作错误")
        elif isinstance(e, ValueError):
            print("代码可能未完成，导致了张量维度错误")
        elif isinstance(e, RuntimeError):
            print("代码可能未完成，导致了运行时错误")
        else:
            print("代码可能未完成，导致了断言失败")
        raise NotImplementedError("请先完成 TODO 部分的代码！") from e
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        raise

test_flash_attention_sim()
```
> block_size=1: max abs diff = 2.98e-07
> block_size=2: max abs diff = 2.38e-07
> block_size=4: max abs diff = 1.19e-07
> block_size=8: max abs diff = 1.19e-07
> [seq=8, dim=4, block=2] 最大误差: 1.490116e-07
> [seq=5, dim=3, block=3] 最大误差: 8.940697e-08
> [seq=3, dim=2, block=1] 最大误差: 5.960464e-08
> ✅ Online Softmax 与分块计算逻辑正确！
> FlashAttention 分块计算逻辑验证通过。

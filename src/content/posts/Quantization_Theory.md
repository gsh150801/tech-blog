---
title: task5 量化推理与部署
date: 2026-09-06
tags: [量化推理, 部署, 量化理论]
draft: false
---
> 课程项目：DataWhale组织的大模型算法与系统教程  [llm-algo-leetcode](https://github.com/datawhalechina/llm-algo-leetcode)

> Datawhale 是一个专注于AI领域的开源组织，成立于2018年，我们汇聚了一群有开源精神和探索精神的理想主义者，致力于分享最前沿的AI知识，改善学习环境，我们的价值观是：**for the learner，和学习者一起成长。**
# 量化理论
## 为何要做量化？
主要目的是为了降低显存占用，改善带宽压力。常见的权重格式有FP16、BF16、INT8、INT4，其中FP16和BF16占16/8=2字节数，INT8、INT4分别占1字节数、0.5字节数；对于一个nB的模型来说，这些格式分别占用的显存大概是2nGB、2nGB、nGB、n/2 GB。   

在模型权重本身占用的显存下降了后，
1. 剩下的显存空间也可以用于分配给更大的batch或更长的上下文
2. 读权重时需要搬运的数据更少，也能降低HBM带宽压力
3. 在带宽受限场景下，会明显改善吞吐

当然，量化不是对于所有层所有权重都是可行的：
1. 激活值可能仍然保留较高精度
2. 部分层会保留FP16或BF16累加
3. 反量化和scale处理也有额外开销
4. INT8/INT4是否真的加速，还取决于硬件是否原生支持低比特矩阵运算；如果硬件缺少对应T ensor Core/MMA支持，量化有时只会省显存，不一定省时间

**量化的收益：显存更小+带宽更低+吞吐更高**  
但 并非位宽缩小了多少，速度就提升多少

### 码上学
```python
def calculate_weight_memory(num_params_b, dtype):
    """
    计算模型权重的显存占用。

    Args:
        num_params_b: 参数量（单位：B，即十亿）
        dtype: 数据类型，可选 'fp16', 'bf16', 'int8', 'int4'

    Returns:
        memory_gb: 显存占用（单位：GB）
    """
    bytes_per_param = {'fp16': 2, 'bf16': 2, 'int8': 1, 'int4': 0.5}[dtype]
    return num_params_b * bytes_per_param


def test_calculate_weight_memory():
    result = calculate_weight_memory(7, 'fp16')
    assert abs(result - 14.0) < 1e-9
    result = calculate_weight_memory(7, 'int8')
    assert abs(result - 7.0) < 1e-9
    result = calculate_weight_memory(7, 'int4')
    assert abs(result - 3.5) < 1e-9
    print('✅ calculate_weight_memory tests passed')

# 运行测试
test_calculate_weight_memory()

# 直接计算 7B 模型在不同格式下的权重显存占用
num_params = 7
dtypes = ['fp16', 'bf16', 'int8', 'int4']

print('7B 模型权重显存占用对比：')
print('-' * 40)
for dtype in dtypes:
    memory = calculate_weight_memory(num_params, dtype)
    print(f'{dtype.upper():<6} {memory:>6.1f} GB')

```
运行结果：    
| 数据格式 | 7B模型权重显存占用 |
| ---- | ---- | 
| FP16    | 14.0GB    | 
| BF16    | 14.0GB    | 
| INT8    | 7.0GB    | 
| INT4    | 3.5GB    |  

## 量化的方法有哪些？
最常见的量化写法：
$$\
q = round(x / scale) + zero_point
$$
其中：
  * scale决定数值映射比例
  * zero_point决定零点是否偏移  

基于该公式，常见的量化组合有四种：
1. 对称量化：`zero_point = 0`，实现简单，常用于权重
2. 非对称量化：保留`zero_point`，适合分布偏移明显的数据
3. per-tensor：整个张量共用一组`scale`
4. per-channel：每个通道单独一组`scale`，通常精度更好，但元数据更多

经验上：
- 权重量化常常更适合 per-channel
- 激活量化常常更依赖校准数据
- 极低比特时，误差主要不来自平均值，而来自离群值和分布偏斜

为什么激活更难量化？
- 权重分布通常相对稳定，离群值更少
- 激活会随 token、层和上下文变化，分布波动更大
- 一些激活通道可能出现明显离群值，直接压到低比特时更容易失真
- 这也是为什么很多方案会做权重-激活协同处理，或者引入 SmoothQuant 这类预处理思路
在这里开始写。

### 码上学
```python
# 实现一个最简单的量化函数，输入浮点张量，输出量化整数和 scale。
import torch


def quantize_per_tensor(x, num_bits=8):
    """
    对张量做对称 per-tensor 量化。

    Returns:
        q: 量化后的整数张量
        scale: 量化比例
    """
    qmax = 2 ** (num_bits - 1) - 1
    scale = x.abs().max() / qmax if x.numel() > 0 else torch.tensor(1.0, device=x.device, dtype=x.dtype)
    scale = torch.clamp(scale, min=1e-8)
    q = torch.clamp(torch.round(x / scale), -qmax - 1, qmax).to(torch.int8)
    return q, scale


def dequantize_per_tensor(q, scale):
    return q.to(torch.float32) * scale


def test_quantize_per_tensor():
    x = torch.tensor([-1.0, -0.5, 0.0, 0.5, 1.0])
    q, scale = quantize_per_tensor(x, 8)
    x_hat = dequantize_per_tensor(q, scale)
    assert q.dtype == torch.int8
    assert x_hat.shape == x.shape
    print('q:', q.tolist())
    print('scale:', float(scale))
    print('x_hat:', x_hat.tolist())
    print('✅ quantize_per_tensor tests passed')

# 运行测试
test_quantize_per_tensor()
```

```python
# 直接观察 8-bit 和 4-bit 的量化误差差异
torch.manual_seed(0)
x = torch.randn(1024) * 2

for bits in [8, 4]:
    q, scale = quantize_per_tensor(x, bits)
    x_hat = dequantize_per_tensor(q, scale)
    mse = torch.mean((x - x_hat) ** 2).item()
    max_err = torch.max(torch.abs(x - x_hat)).item()
    print(f'{bits}-bit -> MSE={mse:.6f}, max_err={max_err:.6f}')
```
运行结果：
8-bit -> MSE=0.000348, max_err=0.032230
4-bit -> MSE=0.112438, max_err=0.585692

我们可以看到保留的位数越少，相对的误差也会更大些。因此在量化时，也要考虑量化对模型性能的影响大不大。

## PT1、QAT、GPTQ、AWQ、GGUF

这几个名字其实不在同一层：

- **PTQ / QAT** 先回答的是“量化发生在什么时候”
- **GPTQ / AWQ** 回答的是“训练后量化时，用什么方法尽量保住精度”
- **GGUF** 回答的是“量化结果最后怎么打包和分发”

从原理上看，可以按三层来理解：

### 1) PTQ 和 QAT：量化介入的位置
- **PTQ（Post-Training Quantization）**：先把模型训练完，再用少量校准数据估计 scale / zero point，把权重或激活映射到低比特空间。它的核心优点是成本低、落地快；缺点是量化误差没有在训练阶段被显式优化。
- **QAT（Quantization-Aware Training）**：在训练或微调时就把量化误差“模拟”进去，让模型参数学会适应低比特表示。它的核心思路不是单纯更精确，而是把误差提前暴露给优化过程，让模型自己补偿。

### 2) GPTQ 和 AWQ：训练后量化时，怎么减少误差
- **GPTQ** 更像是“带误差补偿的权重量化”。它利用少量校准数据近似估计二阶信息，量化某一层时尽量把量化误差压到对输出影响最小的方向上。直觉上，它不是只看每个权重的大小，而是看“哪些改动更伤输出”，然后做局部修正。
- **AWQ** 更强调“激活感知”。它会关注不同通道在真实输入下的重要性，尽量保护那些对输出更敏感的通道，让少数关键通道保留更高的表示质量。它的核心不是把所有权重平均压缩，而是先找出“最不能丢”的部分。

### 3) GGUF：量化结果如何被部署和加载
- **GGUF** 更偏文件格式和生态封装，不是单一的量化算法。它会把量化后的权重、scale、元数据和加载所需的信息组织成便于本地推理引擎读取的形式。
- 它的价值在于让量化模型更容易被 mmap、分发和跨工具链使用，所以更像“量化成果的交付格式”。

如果把它们放到同一张图里看：

- **PTQ / QAT**：决定“在哪一步量化”
- **GPTQ / AWQ**：决定“量化时怎么尽量保精度”
- **GGUF**：决定“量化完怎么存、怎么发、怎么加载”

所以不要把它们当成谁更先进的单选题，而要看你当前要解决的问题：
- 想快速落地，先看 PTQ
- 想在 PTQ 下尽量少掉点精度，看 GPTQ / AWQ
- 想把模型交付到本地推理生态，看 GGUF

如果你要判断什么时候更适合保守量化或直接考虑 QAT，可以先看这几个典型场景：

- 小模型生成任务对精度非常敏感
- 激活值离群值明显，INT4 误差过大
- 需要保持与基线几乎一致的输出质量
### 码上学
```python
# 直接对比 7B 模型在 FP16 / INT8 / INT4 下的显存节省
base = calculate_weight_memory(7, 'fp16')
for dtype in ['int8', 'int4']:
    mem = calculate_weight_memory(7, dtype)
    saving = 1 - mem / base
    print(f'{dtype.upper():<4} memory={mem:.1f} GB, saving={saving:.0%}')
```
运行结果：
INT8 memory=7.0 GB, saving=50%
INT4 memory=3.5 GB, saving=75%

## 量化啥时候要考虑QAT
QAT（Quantization-Aware Training）不是第一选择，但它在以下场景里很有价值：

- PTQ 之后精度损失过大，比如困惑度或任务指标下降明显
- 模型本身对低比特特别敏感，尤其是较小模型或生成类任务
- 你有足够的训练数据和算力，能够接受再训练或微调成本

一句话判断：
- 如果目标是“快速落地”，先用 PTQ
- 如果目标是“把低比特精度尽量拉回来”，再考虑 QAT

QAT 的代价是训练流程更复杂、成本更高，但它能把量化误差直接纳入训练过程，是 PTQ 之外的重要补救路线。

### 码上学
```python
def qat_recommendation(ptq_drop, acceptable_drop=0.5, retrain_budget_hours=0, sensitivity='medium'):
    score = 0
    if ptq_drop > acceptable_drop:
        score += 2
    if sensitivity == 'high':
        score += 1
    if retrain_budget_hours >= 10:
        score += 1
    if ptq_drop > acceptable_drop and retrain_budget_hours >= 10:
        recommendation = 'QAT'
    else:
        recommendation = 'PTQ'
    return {
        'recommendation': recommendation,
        'risk_score': score,
        'ptq_drop': ptq_drop,
        'acceptable_drop': acceptable_drop,
    }

cases = [
    (0.2, 0.5, 0, 'low'),
    (0.8, 0.5, 12, 'high'),
    (0.6, 0.5, 8, 'high'),
]
for case in cases:
    print(case, '->', qat_recommendation(*case))
print('QAT is worth considering when PTQ drop is too large and retraining budget exists')
```
运行结果：
(0.2, 0.5, 0, 'low') -> {'recommendation': 'PTQ', 'risk_score': 0, 'ptq_drop': 0.2, 'acceptable_drop': 0.5}
(0.8, 0.5, 12, 'high') -> {'recommendation': 'QAT', 'risk_score': 4, 'ptq_drop': 0.8, 'acceptable_drop': 0.5}
(0.6, 0.5, 8, 'high') -> {'recommendation': 'PTQ', 'risk_score': 3, 'ptq_drop': 0.6, 'acceptable_drop': 0.5}
QAT is worth considering when PTQ drop is too large and retraining budget exists

## 量化常见误区
* INT4一定比INT8好？
> 比特更低并不自动更优，误差和硬件支持都可能让 INT4 更难用。
* 量化只是改一下dtype？
> 真正的量化会涉及校准、分组、反量化、累加精度和 kernel 支持。
* 量化一定不影响效果？
> 不同层、不同通道、不同模型对低比特的容忍度差别很大。
* 量化只影响权重？
> 不完整。推理时真正卡住性能的常常还包括激活、缓存和带宽。  

**量化的目标不是“把精度尽可能压低”，而是在“误差可接受”的前提下把显存和带宽压力降下来。**

### 码上学
```python
def quantization_risk(bitwidth, hardware_support=True, calibration_quality=1.0, activation_sensitive=False):
    score = 0
    if bitwidth <= 4:
        score += 2
    if not hardware_support:
        score += 2
    if calibration_quality < 0.7:
        score += 1
    if activation_sensitive:
        score += 1
    if score >= 4:
        level = 'high'
    elif score >= 2:
        level = 'medium'
    else:
        level = 'low'
    return {
        'risk_level': level,
        'risk_score': score,
        'bitwidth': bitwidth,
    }

cases = [
    (8, True, 0.9, False),
    (4, True, 0.8, True),
    (4, False, 0.6, True),
]
for case in cases:
    print(case, '->', quantization_risk(*case))
print('quantization fails when bitwidth, calibration, and hardware support are all under pressure')
```
运行结果：
(8, True, 0.9, False) -> {'risk_level': 'low', 'risk_score': 0, 'bitwidth': 8}
(4, True, 0.8, True) -> {'risk_level': 'medium', 'risk_score': 3, 'bitwidth': 4}
(4, False, 0.6, True) -> {'risk_level': 'high', 'risk_score': 6, 'bitwidth': 4}
quantization fails when bitwidth, calibration, and hardware support are all under pressure
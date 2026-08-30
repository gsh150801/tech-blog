---
title: KV Cache 与推理服务内存管理
date: 2026-08-30
tags: [kv cache, 推理服务内存管理]
draft: false
---
# page attention｜vllm分页注意力
## 在线推理场景下的问题
在线推理服务里，请求不会整齐地一起开始、一起结束：**有的 prompt 很短，有的上下文很长，有的很快生成完，有的还在继续 decode**。如果仍然按最大长度给每个请求预留整块 KV Cache，显存会被大量浪费，GPU 也会因为静态 batch 里的空洞而等待。
## vllm给出的解决思路/方法
PagedAttention 的思路是把 KV Cache 像分页内存一样管理：物理显存切成固定大小的 block，每个请求只维护一张逻辑到物理的 block table。prefill 时按需申请，decode 跨块时再补新 block，真正计算时再按表拼回逻辑连续的缓存。
下面是具体的痛点和解法：
> **痛点 1：Static Batching 的低效**
> 在传统的 PyTorch 推理中，Batch 内的不同请求长度不一。如果 Request A 生成了 10 个 Token 就结束了，而 Request B 需要生成 100 个，那么 A 生成完后 GPU 只能干等 B（即用 Padding 填充计算），导致算力非常浪费。
> **解法：Continuous Batching (Orca/vLLM)**
> 打破 Static Batch 的概念，在 `Step` (Iteration) 粒度上动态重组。A 结束了，立刻把队列里的 Request C 塞进来接着算。

> **痛点 2：KV Cache 的显存碎片化**
> KV Cache 的显存大小是**不可预知的**（你不知道模型最终会生成多长的回复）。如果我们提前按 `max_len` 分配整块显存，会造成严重的内部碎片（超过 60% 浪费）。
> **解法：PagedAttention (vLLM)**
> 借鉴操作系统的虚拟内存管理。把显存切分成固定大小的 **Block**（比如 1 个 Block 存 16 个 Token）。在生成时，按需分配物理 Block，并通过 `Block Table` 记录逻辑 Token 序列到物理块的映射。

> **一句话闭环：** PagedAttention 的核心不是把 KV Cache 变“小”，而是把它变成“可按块寻址、可按需复用”的结构。这样一来，prefill 负责一次性申请所需 Block，decode 只在越界时补 1 个 Block，最后再通过块表把离散物理块恢复成逻辑连续缓存。  

**把Static Batching的（同一batch内不同请求的）快等慢通过Continuous Batching变成互相相对独立，减少算力浪费；把原先的粗糙的按max_len分配显存（碎片+浪费），通过`block table`的方式变成按需分配（利用碎片）**
在这里开始写。

## 码上学
思路：  
> 系统需要维护一个 `BlockTable`，它本质上就是“逻辑块编号 → 物理块 ID”的映射表。prefill 阶段先按序列长度向上取整，申请足够的物理 Block；decode 阶段只在跨过 block 边界时额外申请 1 个 Block；真正做 attention 时，再按 block_table 把离散的物理块重新拼回逻辑序列。下面的代码会把这条链路拆成 5 个小动作：初始化缓存池、计算所需 block 数、分配 prefill block、判断 decode 是否跨块、按块表恢复缓存。  

首先，让我们用纯 Python 模拟它的核心数据结构：
1. **Physical Block Pool (物理块池)**：一个预先分配好的大张量，形状为 `[num_blocks, block_size, hidden_dim]`。
2. **Block Table (块表)**：每个 Request 都有一个专属的块表，它是一个整数列表（`List[int]`），记录了这个 Request 的第 $i$ 个逻辑块存在物理池的哪个索引里。
3. **KV Cache Manager**：负责在 Token 生成时，“按需”分配新的物理块索引。  

**极简版vllm内存管理器**
```python
class Request:
    def __init__(self, request_id: int, prompt_len: int):
        self.request_id = request_id
        self.seq_len = prompt_len
        # 记录此请求占据的物理 Block 索引
        self.block_table: List[int] = []

class KVCacheManager:
    def __init__(self, num_blocks: int, block_size: int, head_dim: int):
        self.num_blocks = num_blocks
        self.block_size = block_size
        self.head_dim = head_dim
        
        # 模拟预分配一块大显存池 (vLLM 会在 GPU 上分配几 GB)
        # 形状: [num_blocks, block_size, head_dim]
        self.physical_kv_cache = torch.zeros(num_blocks, block_size, head_dim)
        
        # 跟踪哪些物理块被占用了
        self.free_blocks: List[int] = list(range(num_blocks))

    def allocate_for_prefill(self, req: Request):
        """
        请求刚进来时 (Prefill阶段)，为它的 Prompt 长度分配所需的全部 Block
        """
        # ==========================================
        # TODO 1: 计算需要的 block 数量
        # 提示: 向上取整 (seq_len / block_size)
        # ==========================================
        # needed_blocks = ???
        needed_blocks = (req.seq_len + self.block_size - 1) // self.block_size
        
        # ==========================================
        # TODO 2: 从 free_blocks 中弹出对应数量的 block 索引，
        # 并追加到请求的 block_table 中
        # 如果 free_blocks 不够了，抛出 RuntimeError("OOM")
        # ==========================================
        # block_id = ???
        # req.block_table = ???
        if len(self.free_blocks)< needed_blocks:
            raise RuntimeError("OOM")
        for _ in range(needed_blocks):
            req.block_table.append(self.free_blocks.pop(0))
        
        # pass

    def allocate_for_decode(self, req: Request):
        """
        自回归生成时 (Decode阶段)，检查序列长度。
        如果当前最后一个 Block 满了，则按需分配 1 个新 Block。
        """
        req.seq_len += 1  # 长度加 1
        
        # ==========================================
        # TODO 3: 判断是否刚好需要跨入新的一块 Block？
        # 条件：加 1 后的 seq_len 除以 block_size 余数是多少？
        # ==========================================
        # is_new_block_needed = ???
        is_new_block_needed = (req.seq_len%self.block_size)==1
        # 如果需要，尝试分配 1 个新的物理 Block 放入块表
        # if is_new_block_needed:
        #    if not self.free_blocks: ...
        #    req.block_table.append(???)
        if is_new_block_needed:
            if not self.free_blocks:
                raise RuntimeError("OOM")
            req.block_table.append(self.free_blocks.pop(0))
        # pass

    def get_physical_cache(self, req: Request) -> torch.Tensor:
        """
        (模拟 PagedAttention 底层加载逻辑)
        根据块表，把不连续的物理块“拼凑”成逻辑上连续的 KV Cache (仅作验证用途)
        """
        # ==========================================
        # TODO 5: 根据 req.block_table 恢复物理缓存
        # ==========================================
        # blocks = ???
        # cat_blocks = ???
        blocks = [self.physical_kv_cache[block_id] for block_id in req.block_table]
        cat_blocks = torch.cat(blocks,dim=0)
        return cat_blocks[:req.seq_len]

```
**测试单元**
```python
# 运行此单元格以测试你的实现
def test_paged_attention_manager():
	try:
		# Case 1: 典型 Prefill + Decode + Cache 拼装
		manager = KVCacheManager(num_blocks=10, block_size=4, head_dim=64)
		print("初始化内存池...")

		req1 = Request(request_id=1, prompt_len=6)
		manager.allocate_for_prefill(req1)
		assert len(req1.block_table) == 2, "长度 6 的请求应分配 2 个 Block！"
		assert len(manager.free_blocks) == 8, "池中应该剩下 8 个空闲块！"
		print(f"✅ Prefill 测试通过！Req1 分配的块表: {req1.block_table}")

		manager.allocate_for_decode(req1)
		assert len(req1.block_table) == 2, "生成第 7 个 token 时不应该分配新块！"

		manager.allocate_for_decode(req1)
		manager.allocate_for_decode(req1)
		assert len(req1.block_table) == 3, "生成第 9 个 token 时应当分配了第 3 个新块！"
		assert len(manager.free_blocks) == 7, "池中应该剩下 7 个空闲块！"
		print(f"✅ Decode 动态分配测试通过！Req1 最新块表: {req1.block_table}")

		for block_id, value in zip(req1.block_table, [1.0, 2.0, 3.0]):
			manager.physical_kv_cache[block_id].fill_(value)
		cache = manager.get_physical_cache(req1)
		assert cache.shape == (9, 64), f"拼装出来的连续 Cache 形状不对，应为 (9, 64)，实为 {cache.shape}"
		assert torch.all(cache[:4] == 1.0), "第 1 个 Block 未正确拼装！"
		assert torch.all(cache[4:8] == 2.0), "第 2 个 Block 未正确拼装！"
		assert torch.all(cache[8:] == 3.0), "第 3 个 Block 的截断拼装不正确！"
		print("✅ Cache 拼装测试通过！多块物理缓存被正确恢复为逻辑连续序列。")

		# Case 2: 恰好跨越 block 边界时，Decode 应该分配新块，并正确截断最后一块
		manager2 = KVCacheManager(num_blocks=4, block_size=4, head_dim=8)
		req2 = Request(request_id=2, prompt_len=4)
		manager2.allocate_for_prefill(req2)
		assert len(req2.block_table) == 1, "长度 4 的请求应只分配 1 个 Block！"
		manager2.allocate_for_decode(req2)
		assert len(req2.block_table) == 2, "长度 5 的请求应分配第 2 个 Block！"
		manager2.physical_kv_cache[req2.block_table[0]].fill_(7.0)
		manager2.physical_kv_cache[req2.block_table[1]].fill_(8.0)
		cache2 = manager2.get_physical_cache(req2)
		assert cache2.shape == (5, 8), f"拼装出来的连续 Cache 形状不对，应为 (5, 8)，实为 {cache2.shape}"
		assert torch.all(cache2[:4] == 7.0), "边界块的前 4 个 token 不正确！"
		assert torch.all(cache2[4:] == 8.0), "边界块的最后 1 个 token 不正确！"
		print("✅ 边界分配与截断测试通过！")

		# Case 3: OOM 分支必须抛出 RuntimeError
		oom_manager = KVCacheManager(num_blocks=1, block_size=4, head_dim=8)
		oom_req = Request(request_id=3, prompt_len=5)
		try:
			oom_manager.allocate_for_prefill(oom_req)
		except RuntimeError as e:
			assert "OOM" in str(e), "OOM 异常信息不正确！"
			print("✅ OOM 测试通过！")
		else:
			raise AssertionError('显存池不足时应该抛出 RuntimeError("OOM")！')

		print("\n✅ All Tests Passed! PagedAttention 内存管理逻辑验证通过。")

	except NotImplementedError:
		print("请先完成 TODO 部分的代码！")
		raise
	except (AttributeError, NameError, TypeError, ValueError, AssertionError, RuntimeError) as e:
		if isinstance(e, AttributeError):
			print("代码未完成，无法找到必要的属性")
		elif isinstance(e, NameError):
			print("代码可能未完成，导致变量为 NoneType。")
		elif isinstance(e, TypeError):
			print("代码可能未完成，导致变量为 NoneType。")
		elif isinstance(e, ValueError):
			print("代码可能未完成，导致了张量维度错误")
		elif isinstance(e, AssertionError):
			print("代码可能未完成，导致了断言失败")
		elif isinstance(e, RuntimeError):
			print("代码可能未完成，导致了运行时错误")
		else:
			print("代码可能未完成，导致了断言失败")
		raise NotImplementedError("请先完成 TODO 部分的代码！") from e
	except Exception as e:
		print(f"❌ 测试失败: {e}")
		raise


test_paged_attention_manager()

```
> 初始化内存池...
✅ Prefill 测试通过！Req1 分配的块表: [0, 1]
✅ Decode 动态分配测试通过！Req1 最新块表: [0, 1, 2]
✅ Cache 拼装测试通过！多块物理缓存被正确恢复为逻辑连续序列。
✅ 边界分配与截断测试通过！
✅ OOM 测试通过！
✅ All Tests Passed! PagedAttention 内存管理逻辑验证通过。  
  
疑问点：  
**1. needed_block的公式为何需要+block_size和-1？**  
两个数字各自在干什么？
把 seq_len 拆成 b × q + r，真正需要的块数是：
```
r > 0 →  q + 1      （有余数，尾巴要另起一块）
r = 0 →  q          （正好整除，不多不少）
```
`+ block_size` —— 制造"进位"的力。余数 `r` 最小是 1，加上 `b - 1` 后变成 `r + b - 1 ≥ b`，刚好跨过下一个整除边界，让 `//` 把商从 `q` 抬到 `q+1`。如果只 `+1（(n+1)//b）`，只有 `r = b-1` 时才进位，`r = 1、2` 时仍然算错——所以必须是 `+ b` 这个量级的量，才能保证任意非零余数都进位。

`- 1` —— 给整除情况留退路。加的是 `b - 1` 而不是 `b`，是为了让 `r = 0` 时 `r + b - 1 = b - 1 < b`，不足以跨边界，商仍停在 `q`。写成 `+ b` 的话：
```
seq_len = 8, block_size = 4:  (8 + 4) // 4 = 3   ← 错，只要 2 块
seq_len = 0:                  (0 + 4) // 4 = 1   ← 错，凭空申请一块
```
一句话概括：`+b` 保证有余数时一定进位，`-1` 保证没余数时不进位。两者合起来就是整数域的 `ceil(n / b)`。  



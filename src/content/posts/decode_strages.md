---
title: 解码策略和投机解码
date: 2026-08-27
tags: [解码策略，投机解码]
draft: false
---
# 解码策略
大模型的最后一步输出什么？
模型对下一个词的预测是一串未经归一化的得分，称为 `Logits`（形状为 `[vocab_size]`，比如 32000 个数字）。

## 三种常用的截断与平滑策略：
1. **Temperature ($T$)**：在 Softmax 之前，将所有 `Logits` 除以 $T$。
    * $T < 1$：拉大差距，让高分更高，低分更低（结果更确定）。
    * $T > 1$：缩小差距，让得分变得平均（结果更随机，也就是更“胡言乱语”）。
2. **Top-K 截断**：只保留得分最高的 $K$ 个词的概率，把排名第 $K+1$ 之后的词全部强制剔除（概率置为 $-\infty$）。
3. **Top-p (Nucleus) 核采样**：动态截断。按概率从大到小排序，当累加的概率刚好超过阈值 $p$ 时，截断后面的词。它可以根据分布的平缓程度，自动决定截断的数量。

这三种策略本质上都是在**修改 logits 的分布形状**，下一步看它们如何串成完整的解码流水线。


## 码上学
```python
def apply_temperature(logits: torch.Tensor, temperature: float) -> torch.Tensor:
    """
    应用温度调节。注意：通常 T=1.0 意味着不改变，T 越接近 0 越确定（Greedy）。
    """
    # ==========================================
    # TODO 1: 温度下限与缩放
    # ==========================================
    # temp = ???
    temp = max(temperature, 1e-8) # 设置一个极小的数，避免T为0时出错
    return logits / temp

def apply_top_k(logits: torch.Tensor, top_k: int) -> torch.Tensor:
    """
    Top-K 截断。只保留值最大的 top_k 个，其余置为 -inf。
    """
    if top_k <= 0 or top_k >= logits.size(-1):
        return logits
        
    # ==========================================
    # TODO 2: Top-K 截断
    # ==========================================
    # filter_value = ???
    # kth_values = ???
    # logits = ???
    filter_value = float('-inf')#填充值
    # 取第K个值
    kth_values,_ = torch.topk(logits, top_k, dim=-1, largest=True, sorted=True)
    kth_values = kth_values[...,-1:]
    # logits中小于第K个值的全部用填充值填充
    logits = torch.where(logits < kth_values, torch.tensor(filter_value, device=logits.device), logits)
    return logits

def apply_top_p(logits: torch.Tensor, top_p: float) -> torch.Tensor:
    """
    Top-p (Nucleus) 核采样截断。
    """
    if top_p <= 0.0 or top_p >= 1.0:
        return logits
        
    # 1. 首先需要将 logits 从大到小排序
    # 注意我们需要记住原始的索引 (indices)，因为截断完了还要把它复原回原来的位置！
    sorted_logits, sorted_indices = torch.sort(logits, descending=True)
    
    # 2. 对排序后的概率 (需要先算一遍 Softmax) 计算累加和 (Cumulative Probability)
    cumulative_probs = torch.cumsum(F.softmax(sorted_logits, dim=-1), dim=-1)
    
    # ==========================================
    # TODO 3: Top-p 核心逻辑
    # ==========================================
    # sorted_indices_to_remove = ???
    # sorted_logits[sorted_indices_to_remove] = ???
    # restored_logits = ???
    # 找到需要填充的掩码
    sorted_indices_to_remove = cumulative_probs > top_p
    
    # 向右平移掩码以保留最后一个刚好超过阈值的 token
    sorted_indices_to_remove[..., 1:] = sorted_indices_to_remove[..., :-1].clone()
    sorted_indices_to_remove[..., 0] = 0  # 确保无论如何最高概率的 token 不被丢弃
    
    # 将需要剔除的 sorted_logits 设为极小值
    sorted_logits[sorted_indices_to_remove] = float('-inf')
    
    # 将排序后的 logits 恢复到原始顺序
    restored_logits = torch.zeros_like(logits).scatter_(
        dim=-1, index=sorted_indices, src=sorted_logits
    )

    return restored_logits

def decode_next_token(logits: torch.Tensor, temperature=0.7, top_k=50, top_p=0.9):
    """
    组合以上三种策略，并通过 Multinomial 进行随机多项式采样
    """
    # 1. 调温
    logits = apply_temperature(logits, temperature)
    
    # 2. Top-K 截断 (通常先 K 后 p)
    logits = apply_top_k(logits, top_k)
    
    # 3. Top-p 截断
    logits = apply_top_p(logits, top_p)
    
    # 4. 概率重归一化
    probs = F.softmax(logits, dim=-1)
    
    # 5. 从概率分布中采样 1 个词
    next_token = torch.multinomial(probs, num_samples=1)
    
    return next_token

```

# 投机解码
用草稿模型预先生成候选token和对应的概率，如果draft_prob(x)<=target_prob(x),接受概率为1，则token x会被接受。如果draft_prob(x)>target_prob(x)，则接受概率变为target_prob(x)/draft_prob(x)。

```python

def speculative_verify(draft_probs, target_probs, draft_tokens):
	"""
	验证小模型生成的 K 个 Token，返回被接受的 Token 列表。
	
	Args:
		draft_probs: 小模型生成各个 token 时的概率预测分布, shape [K, vocab_size]
		target_probs: 大模型对这 K 个位置的真实概率预测分布, shape [K, vocab_size]
		draft_tokens: 小模型实际采样出的 K 个 token_id, shape [K]
		
	Returns:
		accepted_tokens: list, 最终被接受的 token_id 序列
	"""
	K = len(draft_tokens)
	accepted_tokens = []
	
	for i in range(K):
		token_id = draft_tokens[i]
		
		# 提取目标概率 p 和草拟概率 q
		p = target_probs[i, token_id].item()
		q = draft_probs[i, token_id].item()
		
		# ==========================================
		# TODO 1: 判断是否 100% 接受
		# 提示: p >= q 时直接接受
		if p >= q:
			accepted_tokens.append(token_id)
		# ==========================================
		# TODO 2: 以 p / q 的概率接受
		# 提示: 否则按 p/q 掷硬币，拒绝则停止验证
		else:
			r = torch.rand(1).item()
			if r < p / q:
				accepted_tokens.append(token_id)
			else:
				break
		# pass
	
	return accepted_tokens
```


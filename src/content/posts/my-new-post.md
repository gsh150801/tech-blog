---
title: mlsys的安装与使用入门
date: 2026-09-06
tags: [mlsys,]
draft: false
---
> 课程项目：DataWhale组织的大模型算法与系统教程 [llm-algo-leetcode](https://github.com/datawhalechina/llm-algo-leetcode)

> Datawhale 是一个专注于AI领域的开源组织，成立于2018年，我们汇聚了一群有开源精神和探索精神的理想主义者，致力于分享最前沿的AI知识，改善学习环境，我们的价值观是：for the learner，和学习者一起成长。

## 什么是mlsys？
MLSys·im（Machine Learning Systems Infrastructure Modeling）是一个来自哈佛大学 [cs249r课程](https://harvard-edge.github.io/cs249r_book_dev/)的开源分析建模框架，用第一性原理做 ML 系统性能/成本/碳排放的快速估算。

核心定位
在实际采购或 benchmark 之前，用解析模型快速回答这类问题：
- 这个模型能塞进 GPU 显存吗？
- 训练失败但推理能跑——为什么？
- 我的 LLM 预期 TTFT 是多少？
- 跑 1000 张 GPU 需要多少 replica？
- 碳排放是多少？  

核心能力（28 个可组合求解器）
| 求解器 | 解决的问题 | 
| ---- | ---- | 
| SingleNodeModel    | Roofline 分析，判断 memory-bound / compute-bound | 
| ServingModel    | LLM 推理两阶段：pre-fill（计算密集）vs decode（访存密集）+ KV-cache 压力 | 
| TrainingMemoryModel    | 训练显存分解：权重/梯度/优化器状态/激活 + ZeRO 分层 | 
| DistributedModel    | 3D 并行（数据/张量/流水线）+ all-reduce 通信开销 + 扩缩效率   | 
| MoERoutingModel    | MoE 专家路由不平衡 + all-to-all 通信 | 
| EconomicsModel    | TCO 分解：CapEx / OpEx / 能耗 / 维护 | 
| SustainabilityModel    | 碳足迹、水耗、按地区电网碳强度对比 | 
| ReliabilityModel    | MTBF、checkpoint 间隔（Young-Daly） | 
| ServingCapacityModel    | 从 QPS + P99 目标反推 replica 数量 | 	

特色设计
- 量纲严格检查（dimensionally strict）：运行时强制单位完整，输入输出都有物理单位，杜绝 silent conversion error
- Vetted Registry：硬件规格来自官方 datasheet，每次更新可溯源（Silicon Zoo）
- YAML plan：可以用 mlsysim.yaml 定义集群配置 + 约束断言，支持 CI 集成
- CLI + Python API：pip install mlsysim 后，mlsysim eval Llama3_8B H100 --batch-size 32 即可跑分析
  
### 安装mlsys
需要python>=3.10
```shell
#下载代码库
git clone https://github.com/harvard-edge/cs249r_book
cd cs249r_book/mlsysim
#安装mlsys
pip install -e ".[dev]"
```
查看安装的版本（确认安装成功）
```shell
#打印mlsysim的版本号
python -c "import mlsysim; print(mlsysim.__version__)" # 0.1.2
```

第一个分析
```python
import mlsysim
from mlsysim import Engine

profile = Engine.solve(
    model    = mlsysim.Models.Vision.ResNet50,
    hardware = mlsysim.Hardware.Cloud.A100,
    batch_size = 1,
    precision  = "fp16"
)

print(f"Bottleneck: {profile.bottleneck}")              # → Memory
print(f"Latency:    {profile.latency.to('ms'):~.2f}")   # → 0.54 ms
print(f"Throughput: {profile.throughput:.0f}")          # → 1843 / second
```


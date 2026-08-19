---
title: GPU物理架构与内存层级
description: 真正决定 attention kernel、prefill 吞吐和算子优化边界的，往往是更底层的物理事实：Tensor Core 适合什么计算模式，HBM 和 SRAM 的带宽差距有多大，数据为什么一旦反复搬运就会让算子很快变成 memory bound。
date: 2026-08-20
tags: [GPU, 内存层级]
draft: true

---
0. 位数和显存估算
  在计算机底层，1 Byte（字节）= 8 bits（位）。大模型中常见的格式占用如下：
  - **FP32 (单精度浮点数)**: 32 bits = **4 Bytes**
  - **FP16 (半精度浮点数)**: 16 bits = **2 Bytes**
  - **BF16 (BFloat16)**: 16 bits = **2 Bytes**
  - **INT8 (8位整型)**: 8 bits = **1 Byte**
  - **INT4 (4位整型)**: 4 bits = **0.5 Byte** (通常用于极度压缩的量化如 AWQ/GPTQ)  
  **实战估算：**
  做静态显存估算时，只需要把“模型参数量”乘以对应的“字节数”即可。比如一个 7B（70亿）参数的模型，如果采用 FP16/BF16 加载，纯权重占用的显存就是： 7*10^9*2 Bytes ≈ 14 GB

  混合精度训练时的显存占用：
  在混合精度训练中，显存占用包括：
  - 模型参数（FP16/BF16）：2Φ
  - 梯度（FP16/BF16）：2Φ
  - 优化器状态（FP32）：
    - FP32 主权重：4Φ
    - 一阶动量（Adam）：4Φ
    - 二阶动量（Adam）：4Φ
    - 总计：12Φ
  
  **总显存 = 2Φ + 2Φ + 12Φ = 16Φ** 
1. GPU的内存层级结构
   GPU 的内存结构像一个金字塔，越靠近计算单元的速度越快，但容量越小：
  * **Registers (寄存器)**：
      *   速度最快（<1 个周期），容量极小（每个线程几十个 32-bit 寄存器）。
      *   如果变量太多发生 **Register Spilling (寄存器溢出)**，数据会被回退到较慢的 Local Memory (物理上位于 HBM)。
  * **Shared Memory (SRAM / 片上共享内存)**：
      *   速度极快（~19 TB/s），每个 SM (流多处理器) 只有几百 KB。
      *   **很关键**：它是同一个 Block 内所有线程协作、交换数据的主要高速通道。**Triton 的一个重要作用，就是帮你自动化管理 SRAM 的分配和调度。**
  * **L2 Cache**: 
      *   所有 SM 共享，几十 MB，用于缓冲 HBM 的读写。
  * **HBM (全局显存 / Global Memory)**:
      *   容量大 (40GB ~ 80GB)，但速度相对极慢 (1.5 TB/s ~ 3 TB/s)。
      *   如果算子的每一次计算都需要去 HBM 走一遭（如 PyTorch 原生的多次小操作），就会触发严重的 **Memory Bound (访存受限)**。
2. FlashAttention是如何利用SRAM解决传统Attention的访存瓶颈的？
  > 在SRAM中把注意力得分`S`和`Softmax_block`先计算完了，再传会HBM，减少了数据从HBM传输的次数。
  在标准的自注意力机制中，`S = QK^T` 产生了一个尺寸为 `N \times N` 的巨大矩阵。
*   **PyTorch 原生**：计算出 $S$，把它**写回 HBM**；读取 `S` 计算 Softmax，再**写回 HBM**；读取 Softmax 结果和 $V$，计算出最终结果。这种反复读写 $O(N^2)$ 大小数据的行为，直接导致了显存溢出 (OOM) 和速度极慢。

*   **FlashAttention 的底层逻辑 (Tiling + SRAM)**：
    1.  **切块 (Tiling)**：将巨大的 $Q, K, V$ 切成小块 (Blocks)，使得这些小块**刚好能塞进容量只有几百 KB 的 SRAM 中**。
    2.  **在 SRAM 内完成一切 (Fusion)**：把 $Q_{block}$ 和 $K_{block}$ 加载到 SRAM，利用 Tensor Core 算出 $S_{block}$。
    3.  **在线归约 (Online Softmax)**：在 SRAM 内部直接更新局部最大值和指数和，避免写回 $S$。
    4.  最后再乘以 $V_{block}$，把最终结果写回 HBM。
**结论**：把 $O(N^2)$ 的 HBM 读写明显压缩到接近 $O(N)$ 的读写。**FlashAttention 不是减少了计算量，而是通过 SRAM 缓解了 Memory Bound 的影响。**.


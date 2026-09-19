# 功能验证：渐进显示 / 定理 / 编号引用

## 渐进显示基础

- 第一步要点
- 第二步要点 <2->
- 第三步要点 <3->

\pause

- pause 之后的要点

> 这页的备注：先讲第一步，再逐步展开。

## 公式编号与交叉引用

由 \ref{eq:pyth} 与 \eqref{eq:euler} 可知，见 图 \ref{fig:demo}、表 \ref{tab:data} 与 定理 \ref{thm:pyth}。

$$
a^2 + b^2 = c^2 \label{eq:pyth}
$$

$$
e^{i\pi} + 1 = 0 \label{eq:euler}
$$

![演示图 \label{fig:demo}](figure.png)

| 名称 | 数值 |
| :--- | ---: |
| 甲 | 1 |
| 乙 | 2 |
表：示例数据 \label{tab:data}

## 定理环境

\begin{theorem}[勾股定理] \label{thm:pyth}
在直角三角形中，斜边满足
$$a^2 + b^2 = c^2$$
其中 $a,b$ 为两条直角边。
\end{theorem}

\begin{proof}
由面积法：以斜边为边的正方形面积等于两个小正方形面积之和。
\end{proof}

\begin{definition}
若对任意 $\varepsilon>0$ 存在 $\delta>0$，则称 $f$ 在 $x_0$ 处连续。
\end{definition}

\begin{remark}
这是无编号的评注块。
\end{remark}

## 行内 overlay 与代码高亮

行内命令：\only<2->{第二步才出现的内容}，以及 \alert<3->{第三步高亮的重点}。

```python
def greet(name: str) -> str:
    """打招呼"""
    return f"Hello, {name}!"
```

```latex
\documentclass[12pt]{article}
\usepackage{amsmath}
\begin{document}
能量守恒：$E = mc^2$
\end{document}
```

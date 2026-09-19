# AIPPT 功能总览

一份 Markdown，导出**可编辑、可点击、带目录与文献**的 PPT

> 讲稿备注：本示例把 AIPPT 的全部能力都用了一遍——公式、定理、算法、分步动画、目录、文献、表格、提示框、代码高亮。直接导出即可对照检查。

\tableofcontents

## 公式：写进 PPT 的是原生公式对象

行内公式 $E = mc^2$、$a_n \to 0$、$\nabla \cdot \vec{E} = \rho/\varepsilon_0$ 与文字同段混排，**双击就能改**。

$$
\frac{\partial u}{\partial t} = \alpha \nabla^2 u
$$

$$
A = \begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix},
\qquad
f(x) = \begin{cases}
  x^2 & x \ge 0 \\
  -x  & x < 0
\end{cases}
$$

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6},
\qquad
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

> 讲稿备注：公式以 OMML 写进 pptx，是 PowerPoint 原生公式对象；同时附带同位置高清图，WPS / LibreOffice 也能正常显示。

## 定理、编号与交叉引用

\begin{theorem}[勾股定理] \label{thm:pyth}
在直角三角形中，两条直角边的平方和等于斜边的平方：
$$a^2 + b^2 = c^2 \label{eq:pyth}$$
\end{theorem}

\begin{proof}
用四个全等直角三角形拼成一个大正方形，比较面积即得。
\end{proof}

由 \eqref{eq:pyth} 可得定理 \ref{thm:pyth} 的结论；相关论述可参考 \cite{knuth1998}。

\begin{definition}
若对任意 $\varepsilon > 0$ 存在 $\delta > 0$，则称 $f$ 在 $x_0$ 处连续。
\end{definition}

## 算法伪代码

\begin{algorithm}[二分查找] \label{alg:bsearch}
\Require 已升序数组 $A$，目标值 $x$
\Ensure 下标，找不到返回 $-1$
\State $lo \gets 0$，$hi \gets n-1$
\While{$lo \le hi$}
  \State $mid \gets \lfloor (lo+hi)/2 \rfloor$
  \If{$A[mid] = x$}
    \State \Return $mid$
  \ElsIf{$A[mid] < x$}
    \State $lo \gets mid+1$
  \Else
    \State $hi \gets mid-1$
  \EndIf
\EndWhile
\State \Return $-1$
\end{algorithm}

算法 \ref{alg:bsearch} 的时间复杂度为 $O(\log n)$。

## 渐进显示：一页一次点击

- 第一步：先给出问题背景
- 第二步：再给出方法要点 <2->
- 第三步：最后给出结论 <3->

\pause

- \alert<4->{重点结论}：行内命令同样可用
- 这里还有 \only<4->{只在这一步出现的内容}

> 讲稿备注：默认「点击出现动画」——放映时按一下出现一条；想每步一页就切换成「展开成多页」。

## 代码高亮

```python
def collatz(n: int) -> int:
    """考拉兹猜想的迭代步数"""
    steps = 0
    while n != 1:
        n = n // 2 if n % 2 == 0 else 3 * n + 1
        steps += 1
    return steps
```

```latex
\documentclass{beamer}
\begin{document}
\begin{frame}{标题}
  公式 $E = mc^2$ 与分步 \pause 显示
\end{frame}
\end{document}
```

## 表格与提示框

| 排序方法 | 平均复杂度 | 是否稳定 | 备注 |
| :--- | ---: | :---: | :--- |
| 冒泡排序 | $O(n^2)$ | 是 | 教学演示 |
| 快速排序 | $O(n\log n)$ | 否 | 工程默认 |
| 归并排序 | $O(n\log n)$ | 是 | 需额外空间 |
表：三种排序算法对比

> [!tip] 提示框支持 6+ 配色
> - `[!tip]` `[!warning]` `[!info]` `[!danger]` …
> - 单元格与提示框里都能放公式，例如 $a^2 + b^2 = c^2$

> [!warning] 注意
> 表格过宽时会按行自动拆成「（续）」页，不会溢出画布。

## 排版细节

- **加粗**、*斜体*、`等宽代码`、==高亮==、[[双链笔记|Obsidian 别名]]
- 二级要点与三级要点：
  - 二级要点缩进 2 空格
    - 三级要点缩进 4 空格
1. 有序列表第一项
2. 有序列表第二项

> 讲稿备注：备注写在 `>` 行里，只出现在演讲者视图，不会出现在页面上。

## 文献引用

- 行内引用 \cite{zhang2020} 或 Markdown 风格 [@li2021]
- 引用会按**首次出现顺序**编号，并在文末**自动追加「参考文献」页**
- 本示例的文献库写在文件末尾的 HTML 注释里（页面上看不见）；界面里也可以直接导入 `.bib` 文件

## 谢谢观看

欢迎交流，也欢迎把本文件改造成你自己的模板！

<!--
  文献库：可以直接写在 HTML 注释里，导出时自动识别（也可以用界面上的「导入 .bib」）
@book{knuth1998,
  author    = {Knuth, Donald E.},
  title     = {The Art of Computer Programming, Volume 3: Sorting and Searching},
  publisher = {Addison-Wesley},
  year      = {1998}
}
@article{zhang2020,
  author  = {张三 and 李四},
  title   = {一个 {GPU} 加速的大规模数值实验},
  journal = {计算机学报},
  year    = {2020}
}
@inproceedings{li2021,
  author    = {Li, Wei and Wang, Fang},
  title     = {Fast Sorting Revisited},
  booktitle = {Proceedings of ACM SIGMOD},
  year      = {2021}
}
-->

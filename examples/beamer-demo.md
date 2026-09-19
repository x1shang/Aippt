# 可编辑公式 · 点击动画 · 目录 · 文献 · 算法
## 一份 Markdown，直接变成能改的 PPT

> 本文件是 AIPPT v2.2 的功能演示。用「仅排版」模式导入本文件即可一键复现全部效果；
> 同目录下的 `references.bib` 会被自动载入，用于本页的文献引用。

## 公式：写进 PPT 的是原生公式对象

行内公式 $E = mc^2$、$a_n \to 0$、$\nabla \cdot \vec{E} = \rho/\varepsilon_0$ 都与文字同段混排——
双击它们就能用 PowerPoint 公式编辑器直接修改，**不是图片**。

块级公式同样是原生对象，居中排版：

$$
\frac{\partial u}{\partial t} = \alpha \nabla^2 u
$$

矩阵、分段函数、求和、极限都不在话下：

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

> 公式由 KaTeX 解析成 MathML，再转成 Office Math（OMML）写进 pptx，
> 全程**不需要安装 TeX**；同时附带一张同位置的高清图，WPS / LibreOffice / Keynote 也能正常显示。

## 定理、编号与交叉引用

\begin{theorem}[勾股定理] \label{thm:pyth}
在直角三角形中，两条直角边的平方和等于斜边的平方：
$$a^2 + b^2 = c^2 \label{eq:pyth}$$
\end{theorem}

\begin{proof}
用四个全等直角三角形拼成一个大正方形，比较面积即得。
\end{proof}

由 \eqref{eq:pyth} 可得定理 \ref{thm:pyth} 的结论；该结论的工程价值可参考 \cite{knuth1998} 与 \cite{li2021}。

## 算法伪代码

\begin{algorithm}[快速排序] \label{alg:qsort}
\Require 数组 $A$，下标 $p, r$
\Ensure $A[p..r]$ 已按升序排列
\If{$p < r$}
  \State $q \gets \Call{Partition}{A, p, r}$
  \State \Call{QuickSort}{$A, p, q-1$}
  \State \Call{QuickSort}{$A, q+1, r$}
\EndIf
\State \Return $A$
\end{algorithm}

算法 \ref{alg:qsort} 的平均时间复杂度为 $O(n \log n)$，最坏情况为 $O(n^2)$。

## 渐进显示：一页一次点击

- 第一步：先给出问题背景
- 第二步：再引出核心定义 <2->
- 第三步：最后给出结论与展望 <3->

\pause

- 也可以这样：用 `\pause` 推进
- 或者用 `\onslide<4->` 设定起始步

> 本页在默认设置下会合成**一页**，放映时按一下出现一条（真·Beamer 手感）；
> 若希望每个分步各占一页，把「分步实现方式」切换成「展开成多页」即可。

## 代码高亮与提示框

```python
def collatz(n: int) -> int:
    """考拉兹猜想的迭代步数"""
    steps = 0
    while n != 1:
        n = n // 2 if n % 2 == 0 else 3 * n + 1
        steps += 1
    return steps
```

> [!tip] 引用与文献
> 本页的引用写作 `\cite{zhang2020}` 或 `[@li2021]`，导出时自动变成 `[1]`、`[2]`，
> 并在文末自动追加「参考文献」页。

## 表格

| 方法 | 复杂度 | 是否稳定 | 备注 |
| :--- | ---: | :---: | :--- |
| 冒泡排序 | $O(n^2)$ | 是 | 教学用 |
| 快速排序 | $O(n\log n)$ | 否 | 工程默认 |
| 归并排序 | $O(n\log n)$ | 是 | 需额外空间 |
表：三种排序算法对比

## 结论

- 公式可编辑、动画可点击、目录可跳页、文献可编号——**Beamer 的学术体验，PPT 的交付形态**
- 全部离线完成，公式渲染与导出不依赖任何网络服务

## 谢谢观看

欢迎交流！


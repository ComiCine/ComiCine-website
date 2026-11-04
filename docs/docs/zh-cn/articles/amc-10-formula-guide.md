---
title: AMC 10 完整公式讲义
description: AMC 10 算术、代数、数论、组合、概率与几何公式讲解、题型识别方法和公式速查表。
---

# AMC 10 完整公式讲义

公式讲解 · 题型识别 · 公式速查

包含 AMC 10 可能用到的算术、代数、数论、排列组合、概率、平面几何、立体几何及竞赛常用公式。

全文分为三部分：

1. 公式讲解：英文名称、公式、符号含义、具体计算方法。
2. 如何判断：根据英文题目、已知条件和所求量选择公式。
3. 公式速查表：集中列出公式及必要的使用条件。

不区分 P1/P2 是否学过，不提供数值例题。

# 第一部分：公式讲解

## A. 数学符号（Mathematical Notation）

| 符号                            | 英文名称                 | 含义与计算方式                           |
| ----------------------------- | ------------------------ | --------------------------------- |
| $\sum$                    | Summation                | 按指定范围依次代入并相加                      |
| $\prod$                   | Product                  | 按指定范围依次代入并相乘                      |
| $n!$                      | Factorial                | 从 1 乘到 $n$，规定 $0!=1$      |
| $\binom nr$               | Combination              | 从 $n$ 个不同对象中选 $r$ 个，顺序不重要 |
| $\lfloor x\rfloor$        | Floor Function           | 不超过 $x$ 的最大整数                 |
| $\lceil x\rceil$          | Ceiling Function         | 不小于 $x$ 的最小整数                 |
| $a\mid b$                 | Divisibility             | $b$ 是 $a$ 的整数倍            |
| $a\equiv b\pmod m$        | Congruence               | $a-b$ 是 $m$ 的整数倍          |
| $\gcd(a,b)$               | Greatest Common Divisor  | 最大公因数                             |
| $\operatorname{lcm}(a,b)$ | Least Common Multiple    | 最小公倍数                             |
| $\varphi(n)$              | Euler's Totient Function | 1 到 $n$ 中与 $n$ 互质的正整数数量   |
| $\lvert x\rvert$          | Absolute Value           | $x$ 到 0 的距离                   |
| $A\cap B$                 | Intersection             | 同时属于 A 和 B                        |
| $A\cup B$                 | Union                    | 属于 A 或 B，允许同时属于                   |
| $A^c$                     | Complement               | 不属于 A                             |
| $\mathbb Z$               | Integers                 | 整数集合                              |
| $\mathbb R$               | Real Numbers             | 实数集合                              |
| $\forall$                 | For All                  | 对所有……                             |
| $\exists$                 | There Exists             | 至少存在……                            |
| $\iff$                    | If and Only If           | 当且仅当                              |

### A1. 求和（Summation）

$$ \boxed{\sum_{k=a}^{b}f(k)} $$

怎么算： 令 $k$ 从 $a$ 开始，每次增加 1，直到 $b$，把所有 $f(k)$ 的结果加起来。

其中：

- $k$：用于逐项计算的变量。
- $a$：起始值。
- $b$：终止值。
- $f(k)$：每一项的计算规则。

### A2. 连乘（Product）

$$ \boxed{\prod_{k=a}^{b}f(k)} $$

怎么算： 令 $k$ 从 $a$ 到 $b$，分别计算 $f(k)$，把得到的所有结果相乘。

与 $\sum$ 的区别是：$\sum$ 做加法，$\prod$ 做乘法。

### A3. 阶乘（Factorial）

$$ \boxed{n!=n(n-1)(n-2)\cdots2\cdot1} $$

其中 $n$ 是非负整数，且 $0!=1$。

怎么算： 从 $n$ 开始不断减 1，并将所有正整数相乘。

## B. 算术（Arithmetic）

### B1. 分数（Fractions）

加减：

$$ \boxed{\frac ab\pm\frac cd=\frac{ad\pm bc}{bd}} $$

乘法：

$$ \boxed{\frac ab\cdot\frac cd=\frac{ac}{bd}} $$

除法：

$$ \boxed{\frac ab\div\frac cd=\frac{ad}{bc}} $$

怎么算：

- 加减法：通分后将分子相加或相减。
- 乘法：分子乘分子，分母乘分母。
- 除法：将除数上下颠倒后相乘。
- 最后约分。

所有分母必须非零，除数也不能为零。

### B2. 比例（Ratios）

若：

$$ a:b=m:n $$

则：

$$ \boxed{a=km,\qquad b=kn} $$

如果已知总量 $S=a+b$：

$$ \boxed{a=\frac{m}{m+n}S} $$

$$ \boxed{b=\frac{n}{m+n}S} $$

怎么算： 将比例数字加起来得到总份数，再按各自所占份数分配总量。

### B3. 正比例与反比例（Direct & Inverse Proportion）

正比例：

$$ \boxed{y=kx} $$

反比例：

$$ \boxed{xy=k} $$

其中 $k$ 是比例常数。

怎么算：

- 正比例：已知一组 $x,y$，计算 $k=y/x$。
- 反比例：已知一组 $x,y$，计算 $k=xy$。
- 再使用相同的 $k$ 求其他数值。

### B4. 百分数变化（Percentage Change）

$$ \boxed{N=O(1+r)} $$

其中：

- $O$：Original Value，原始数值。
- $N$：New Value，新数值。
- $r$：带正负号的变化率，写成小数。

怎么算：

- 增加 $r$：原值乘 $1+r$。
- 减少 $r$：原值乘 $1-r$，此时 $r$ 表示正的减少比例。

反过来计算变化率：

$$ \boxed{r=\frac{N-O}{O}} $$

连续多次变化：

$$ \boxed{N=O(1+r_1)(1+r_2)\cdots(1+r_k)} $$

各次变化均以变化前的数值为基准。

### B5. 算术平均数（Arithmetic Mean）

$$ \boxed{\bar x=\frac{x_1+x_2+\cdots+x_n}{n}} $$

怎么算： 所有数据相加，再除以数据数量。

反推总和：

$$ \boxed{\text{Sum}=n\bar x} $$

### B6. 加权平均数（Weighted Average）

$$ \boxed{ \bar x=\frac{w_1x_1+w_2x_2+\cdots+w_nx_n} {w_1+w_2+\cdots+w_n} } $$

其中 $w_i$ 是对应数据的权重。

怎么算： 每个数值先乘对应权重，再求总和，最后除以权重之和。

### B7. 速度、路程与时间（Speed, Distance & Time）

$$ \boxed{d=vt} $$

$$ \boxed{v=\frac dt} \qquad \boxed{t=\frac dv} $$

其中：

- $d$：Distance，路程。
- $v$：Speed，速度。
- $t$：Time，时间。

怎么算： 根据已知的两个量直接求第三个量，注意单位一致。

平均速度：

$$ \boxed{v_{\mathrm{avg}}=\frac{\text{Total Distance}}{\text{Total Time}}} $$

同距离往返、速度分别为 $v_1,v_2$：

$$ \boxed{v_{\mathrm{avg}}=\frac{2v_1v_2}{v_1+v_2}} $$

相向而行的接近速度为 $v_1+v_2$；同向追及速度为两者的速度差，前提是追赶者更快。

### B8. 工作效率（Work & Rate）

$$ \boxed{W=rt} $$

其中：

- $W$：完成的工作量。
- $r$：单位时间的工作量。
- $t$：工作时间。

如果 A、B 单独完成同一项工作分别需要 $a,b$ 时间，且能独立同时工作：

$$ \boxed{\frac1T=\frac1a+\frac1b} $$

$$ \boxed{T=\frac{ab}{a+b}} $$

怎么算： 将各人的工作效率相加，用总工作量除以总效率。

### B9. 混合与浓度（Mixtures & Concentrations）

$$ \boxed{c=\frac{m_{\mathrm{solute}}}{m_{\mathrm{solution}}}} $$

其中：

- $c$：浓度或质量分数。
- $m_{\mathrm{solute}}$：溶质质量。
- $m_{\mathrm{solution}}$：溶液质量。

混合且没有溶质损失时：

$$ \boxed{ c_{\mathrm{new}}= \frac{m_1c_1+m_2c_2}{m_1+m_2} } $$

怎么算： 分别求出各部分的溶质质量，相加后除以混合物总质量。

### B10. 复合增长（Compound Growth）

$$ \boxed{A=P(1+r)^n} $$

其中：

- $P$：初始量。
- $A$：最终量。
- $r$：每周期增长率。
- $n$：周期数。

怎么算： 每周期乘同一个增长系数，重复 $n$ 次。

如果每周期下降比例 $r>0$：

$$ \boxed{A=P(1-r)^n} $$

## C. 代数（Algebra）

### C1. 指数运算法则（Exponent Laws）

$$ \boxed{a^ma^n=a^{m+n}} $$

$$ \boxed{\frac{a^m}{a^n}=a^{m-n}} $$

$$ \boxed{(a^m)^n=a^{mn}} $$

$$ \boxed{(ab)^n=a^nb^n} $$

$$ \boxed{a^{-n}=\frac1{a^n}} $$

$$ \boxed{a^{1/n}=\sqrt[n]{a}} $$

怎么算：

- 同底数乘法：指数相加。
- 同底数除法：指数相减。
- 幂的幂：指数相乘。
- 负指数：取倒数。
- 分数指数：分母表示开方次数，分子表示乘方次数。

有除法时要求相应底数非零；涉及偶次根时，要满足实数定义条件。

### C2. 代数恒等式（Algebraic Identities）

$$ \boxed{(a+b)^2=a^2+2ab+b^2} $$

$$ \boxed{(a-b)^2=a^2-2ab+b^2} $$

$$ \boxed{a^2-b^2=(a-b)(a+b)} $$

$$ \boxed{a^3+b^3=(a+b)(a^2-ab+b^2)} $$

$$ \boxed{a^3-b^3=(a-b)(a^2+ab+b^2)} $$

$$ \boxed{(a+b)^3=a^3+3a^2b+3ab^2+b^3} $$

$$ \boxed{(a-b)^3=a^3-3a^2b+3ab^2-b^3} $$

怎么算： 观察式子是否符合平方、立方或平方差结构，选择展开或反向因式分解。

### C3. 二次方程求根（Quadratic Formula）

对：

$$ ax^2+bx+c=0,\qquad a\ne0 $$

有：

$$ \boxed{x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}} $$

判别式：

$$ \boxed{\Delta=b^2-4ac} $$

怎么算： 确定 $a,b,c$，计算 $\Delta$，再代入求根公式。

- $\Delta>0$：两个不同实根。
- $\Delta=0$：一个重复实根。
- $\Delta<0$：没有实根。

### C4. 韦达定理（Vieta's Formulas）

如果 $r_1,r_2$ 是二次方程 $ax^2+bx+c=0$ 的两个根：

$$ \boxed{r_1+r_2=-\frac ba} $$

$$ \boxed{r_1r_2=\frac ca} $$

怎么算： 不必先求根，直接用系数计算根的和与积。

进一步：

$$ \boxed{r_1^2+r_2^2=(r_1+r_2)^2-2r_1r_2} $$

$$ \boxed{(r_1-r_2)^2=(r_1+r_2)^2-4r_1r_2} $$

用已知的根之和、根之积代入这些恒等式。

### C5. 配方法（Completing the Square）

$$ \boxed{ ax^2+bx+c= a\left(x+\frac{b}{2a}\right)^2+ c-\frac{b^2}{4a} } $$

其中 $a\ne0$。

怎么算：

1. 提出二次项系数 $a$。
2. 将括号内的一次项系数除以 2。
3. 写成完全平方。
4. 调整剩余常数项。

如果 $a>0$，函数最小值为：

$$ \boxed{c-\frac{b^2}{4a}} $$

如果 $a<0$，同一个数值是最大值。

极值发生在：

$$ \boxed{x=-\frac b{2a}} $$

### C6. 绝对值（Absolute Value）

$$ \boxed{ |x|= \begin{cases} x,&x\ge0\\ -x,&x<0 \end{cases} } $$

绝对值方程：

$$ |x-a|=d $$

若 $d\ge0$：

$$ \boxed{x=a\pm d} $$

怎么算： 将绝对值理解为距离，再向左右两个方向分别寻找满足距离要求的位置。

当 $d>0$：

$$ \boxed{|x-a|<d\iff a-d<x<a+d} $$

$$ \boxed{|x-a|>d\iff x<a-d\text{ 或 }x>a+d} $$

### C7. 根式（Radicals）

$$ \boxed{\sqrt{ab}=\sqrt a\sqrt b} \quad(a,b\ge0) $$

$$ \boxed{\sqrt{a^2}=|a|} $$

分母有理化：

$$ \boxed{ \frac1{a+\sqrt b} =\frac{a-\sqrt b}{a^2-b} } $$

适用条件：$b\ge0$ 且 $a^2\ne b$，以确保原式与有理化后的分母均非零。

怎么算： 分子分母同时乘以分母的共轭式，利用平方差消去分母中的根号。

### C8. 算术—几何平均不等式（Arithmetic–Geometric Mean Inequality）

对于非负实数 $a,b$：

$$ \boxed{\frac{a+b}{2}\ge\sqrt{ab}} $$

等价于：

$$ \boxed{(a+b)^2\ge4ab} $$

怎么算：

- 已知和，求积的最大值：使用 $ab\le(a+b)^2/4$。
- 已知正的积，求和的最小值：使用 $a+b\ge2\sqrt{ab}$。

等号成立当且仅当 $a=b$。

对 $n$ 个非负实数：

$$ \boxed{ \frac{x_1+\cdots+x_n}{n} \ge\sqrt[n]{x_1x_2\cdots x_n} } $$

### C9. 柯西—施瓦茨不等式（Cauchy–Schwarz Inequality）

$$ \boxed{ (a^2+b^2)(c^2+d^2)\ge(ac+bd)^2 } $$

通用形式：

$$ \boxed{ \left(\sum_{i=1}^n a_i^2\right) \left(\sum_{i=1}^n b_i^2\right) \ge \left(\sum_{i=1}^n a_ib_i\right)^2 } $$

怎么算： 将目标表达式拆成两个平方和与一个对应乘积和，再根据不等式建立上下界。

常见推论：

$$ \boxed{a^2+b^2\ge\frac{(a+b)^2}{2}} $$

### C10. 等差数列（Arithmetic Sequences）

$$ \boxed{a_n=a_1+(n-1)d} $$

$$ \boxed{S_n=\frac n2(a_1+a_n)} $$

$$ \boxed{S_n=\frac n2[2a_1+(n-1)d]} $$

其中：

- $a_1$：第一项。
- $a_n$：第 $n$ 项。
- $d$：公差。
- $S_n$：前 $n$ 项和。

怎么算：

- 求指定项：第一项加上 $n-1$ 个公差。
- 求总和：项数乘首尾两项的平均值。
- 求项数：将总和或指定项代入方程求 $n$，再检查是否为正整数。

### C11. 等比数列（Geometric Sequences）

$$ \boxed{a_n=a_1r^{n-1}} $$

当 $r\ne1$：

$$ \boxed{S_n=a_1\frac{1-r^n}{1-r}} $$

如果 $|r|<1$：

$$ \boxed{S_\infty=\frac{a_1}{1-r}} $$

怎么算： 每项乘固定的公比 $r$。根据要求选择第 $n$ 项、有限项求和或无穷项求和公式。

如果 $r=1$，有限项和直接为 $na_1$。

### C12. 常见求和（Standard Sums）

前 $n$ 个正整数：

$$ \boxed{\sum_{k=1}^n k=\frac{n(n+1)}2} $$

前 $n$ 个正整数平方：

$$ \boxed{\sum_{k=1}^n k^2=\frac{n(n+1)(2n+1)}6} $$

前 $n$ 个正整数立方：

$$ \boxed{\sum_{k=1}^n k^3=\left[\frac{n(n+1)}2\right]^2} $$

前 $n$ 个正奇数：

$$ \boxed{\sum_{k=1}^n(2k-1)=n^2} $$

前 $n$ 个正偶数：

$$ \boxed{\sum_{k=1}^n2k=n(n+1)} $$

怎么算： 识别求和对象是否为连续整数、平方、立方、奇数或偶数，再代入项数。

### C13. 裂项相消（Telescoping Sums）

$$ \boxed{\frac1{k(k+1)}=\frac1k-\frac1{k+1}} $$

因此：

$$ \boxed{ \sum_{k=1}^n\frac1{k(k+1)} =1-\frac1{n+1} =\frac n{n+1} } $$

怎么算：

1. 将每项分成两个分式之差。
2. 展开前后相邻的几项。
3. 让正负相同项互相抵消。
4. 只计算没有被抵消的首尾项。

### C14. 二项式定理（Binomial Theorem）

$$ \boxed{(a+b)^n=\sum_{r=0}^{n}\binom nr a^{n-r}b^r} $$

其中：

$$ \boxed{\binom nr=\frac{n!}{r!(n-r)!}} $$

第 $r+1$ 项：

$$ \boxed{T_{r+1}=\binom nr a^{n-r}b^r} $$

怎么算：

1. 确定总指数 $n$。
2. 确定要找的是第几项或哪一个幂次。
3. 找出对应的 $r$。
4. 计算组合数以及两个因子的幂。
5. 如果有负号，把负号也代入相应幂次。

常见组合恒等式：

$$ \boxed{\binom nr=\binom n{n-r}} $$

$$ \boxed{\binom nr+\binom n{r-1}=\binom{n+1}r} $$

$$ \boxed{\sum_{r=0}^{n}\binom nr=2^n} $$

### C15. 对数（Logarithms）

$$ \boxed{a^x=b\iff x=\log_a b} $$

其中 $a>0$、$a\ne1$、$b>0$。

$$ \boxed{\log_a(xy)=\log_a x+\log_a y} $$

$$ \boxed{\log_a\frac xy=\log_a x-\log_a y} $$

$$ \boxed{\log_a(x^r)=r\log_a x} $$

换底公式：

$$ \boxed{\log_a b=\frac{\log_c b}{\log_c a}} $$

怎么算： 将对数问题理解成指数问题，或利用乘法、除法、乘方的对数规则进行合并与拆分。所有真数必须为正数。

## D. 数论（Number Theory）

### D1. 整除（Divisibility）

$$ \boxed{a\mid b\iff b=ak,\quad k\in\mathbb Z,\quad a\ne0} $$

怎么算： 约定 $a\ne0$。判断 $b/a$ 是否为整数，或者检查 $b$ 能否表示成 $a$ 的整数倍。

整除性质：

$$ \boxed{ a\mid b,\ a\mid c \Longrightarrow a\mid(mb+nc) } $$

其中 $m,n$ 为整数。

也就是说，如果 $a$ 同时整除 $b,c$，就能整除它们的任意整数线性组合。

### D2. 整除判定（Divisibility Tests）

| 除数 | 计算方法                         |
| -- | ---------------------------- |
| 2  | 检查个位是否为偶数                    |
| 3  | 计算数位之和，检查是否为 3 的倍数           |
| 4  | 检查末两位组成的数                    |
| 5  | 检查个位是否为 0 或 5                |
| 6  | 同时通过 2、3 的判定                 |
| 8  | 检查末三位组成的数                    |
| 9  | 检查数位之和是否为 9 的倍数              |
| 10 | 检查个位是否为 0                    |
| 11 | 从一端开始交替加减各位数字，检查结果是否为 11 的倍数 |
| 12 | 同时通过 3、4 的判定                 |
| 25 | 检查末两位能否被 25 整除               |

### D3. 质数（Prime Numbers）

正整数 $p>1$ 为质数，当且仅当正约数只有 1 和 $p$。

怎么算： 判断 $N>1$ 是否为质数，只需要检查：

$$ \boxed{p\le\sqrt N} $$

范围内的质数 $p$，是否有一个能整除 $N$。

如果都不能整除，$N$ 就是质数。

### D4. 质因数分解（Prime Factorisation）

对于 $N>1$：

$$ \boxed{N=p_1^{a_1}p_2^{a_2}\cdots p_k^{a_k}} $$

怎么算： 从小质数开始不断试除，把相同的质因数合并成指数形式。

这里的 $p_i$ 是互不相同的质数，$a_i$ 是正整数。

### D5. 正约数个数（Number of Divisors）

$$ \boxed{d(N)=\prod_{i=1}^k(a_i+1)} $$

展开形式：

$$ \boxed{d(N)=(a_1+1)(a_2+1)\cdots(a_k+1)} $$

怎么算： 质因数的每个指数加 1，然后连乘。

对于 $N=1$，约数个数为 1。

### D6. 正约数之和（Sum of Divisors）

$$ \boxed{ \sigma(N)= \prod_{i=1}^k \left(1+p_i+p_i^2+\cdots+p_i^{a_i}\right) } $$

等价地：

$$ \boxed{ \sigma(N)= \prod_{i=1}^k \frac{p_i^{a_i+1}-1}{p_i-1} } $$

怎么算： 对每一种质因数，把零次方到最高次方全部相加，再把各组结果相乘。

### D7. 正约数乘积（Product of Divisors）

$$ \boxed{P(N)=N^{d(N)/2}} $$

怎么算： 先求正约数个数 $d(N)$，将其除以 2，作为 $N$ 的指数。

即使 $d(N)$ 为奇数，公式仍成立。

### D8. 完全平方约数个数（Square Divisors）

$$ \boxed{ d_{\mathrm{square}}(N)= \prod_{i=1}^k \left(\left\lfloor\frac{a_i}{2}\right\rfloor+1\right) } $$

怎么算： 对每个质因数，统计其指数从 0 到 $a_i$ 之间有几个偶数，再将选择数量相乘。

### D9. 完全幂（Perfect Powers）

正整数 $N$ 是完全 $m$ 次幂，当且仅当其质因数分解中每个指数都是 $m$ 的倍数。

$$ \boxed{ N=x^m\iff m\mid a_i\text{ 对所有 }i } $$

怎么算： 分解质因数后，逐一检查指数能否被 $m$ 整除。

### D10. 最大公因数与最小公倍数（GCD & LCM）

$$ \boxed{\gcd(a,b)\operatorname{lcm}(a,b)=ab} $$

这里 $a,b$ 是正整数。

如果：

$$ a=\prod p_i^{\alpha_i}, \qquad b=\prod p_i^{\beta_i} $$

把没有出现的质因数指数看成 0，则：

$$ \boxed{\gcd(a,b)=\prod p_i^{\min(\alpha_i,\beta_i)}} $$

$$ \boxed{\operatorname{lcm}(a,b)=\prod p_i^{\max(\alpha_i,\beta_i)}} $$

怎么算：

- 最大公因数：每种质因数取较小指数。
- 最小公倍数：每种质因数取较大指数。

### D11. 欧几里得算法（Euclidean Algorithm）

$$ \boxed{\gcd(a,b)=\gcd(b,a\bmod b)} $$

怎么算： 反复用「除数和余数」替代原来的两个数，直到余数为零；最后一个非零余数就是 GCD。

### D12. 互质（Coprime）

$$ \boxed{\gcd(a,b)=1} $$

怎么算： 检查两个数是否存在大于 1 的共同质因数。

连续整数满足：

$$ \boxed{\gcd(n,n+1)=1} $$

### D13. 欧拉函数（Euler's Totient Function）

$$ \boxed{ \varphi(N)=N\prod_{p\mid N}\left(1-\frac1p\right) } $$

这里：

- $N$：要求互质计数的正整数。
- $p\mid N$：$p$ 是 $N$ 的质因数。
- $\prod_{p\mid N}$：把所有不同质因数各取一次，连乘对应因子。

人话计算式：

$$ \boxed{ \varphi(N)= N\times \frac{p_1-1}{p_1}\times \frac{p_2-1}{p_2}\times\cdots\times \frac{p_k-1}{p_k} } $$

怎么算： 分解质因数 → 每种不同质因数取一次 → 计算对应分数 → 与 $N$ 连乘。

若 $p$ 为质数：

$$ \boxed{\varphi(p)=p-1} $$

若 $p$ 为质数、$a\ge1$：

$$ \boxed{\varphi(p^a)=p^a-p^{a-1}} $$

另规定：

$$ \boxed{\varphi(1)=1} $$

### D14. 模运算（Modular Arithmetic）

$$ \boxed{a\equiv b\pmod m} $$

当且仅当：

$$ \boxed{m\mid(a-b)} $$

其中模数 $m$ 是正整数。

怎么算： 分别求 $a,b$ 除以 $m$ 的余数，判断是否相同。

运算规则：

$$ \boxed{(a+b)\bmod m=((a\bmod m)+(b\bmod m))\bmod m} $$

$$ \boxed{(ab)\bmod m=((a\bmod m)(b\bmod m))\bmod m} $$

$$ \boxed{a^n\bmod m=((a\bmod m)^n)\bmod m} $$

最后一个公式适用于非负整数指数。

注意： 模运算中的除法不能随意使用。

### D15. 余数表示法（Remainder Representation）

$$ \boxed{N=dq+r} $$

其中：

$$ \boxed{0\le r<d} $$

$d$ 是正整数除数，$q$ 是整数商，$r$ 是余数。

怎么算： 将「除以 $d$ 余 $r$」转化成 $N=dq+r$，再结合其他条件求整数 $q$。

### D16. 个位循环（Units Digit Cycles）

$$ \boxed{\text{Last digit of }N=N\bmod10} $$

对于幂 $a^n$，先确定个位的循环节长度 $L$。

然后：

$$ \boxed{r=n\bmod L} $$

怎么算： 按指数余数 $r$ 确定循环中的位置；如果 $r=0$，取循环最后一项。

| 底数个位 | 循环顺序    |
| ---- | ------- |
| 0    | 0       |
| 1    | 1       |
| 2    | 2,4,8,6 |
| 3    | 3,9,7,1 |
| 4    | 4,6     |
| 5    | 5       |
| 6    | 6       |
| 7    | 7,9,3,1 |
| 8    | 8,4,2,6 |
| 9    | 9,1     |

表格适用于正整数指数。

求末两位时改成模 100；求末三位则改成模 1000，循环需要重新确定。

### D17. 费马小定理（Fermat's Little Theorem）

若 $p$ 为质数且 $p\nmid a$：

$$ \boxed{a^{p-1}\equiv1\pmod p} $$

怎么算： 将大指数按 $p-1$ 分组，利用每组对 $p$ 取余为 1 的性质简化计算。

### D18. 欧拉定理（Euler's Theorem）

若：

$$ \gcd(a,m)=1 $$

则：

$$ \boxed{a^{\varphi(m)}\equiv1\pmod m} $$

怎么算： 先计算 $\varphi(m)$，再利用指数的周期性质简化幂的余数。

### D19. 阶乘中的质因数指数（Factorial Prime Exponents）

$$ \boxed{ v_p(n!)= \sum_{j=1}^{\infty} \left\lfloor\frac n{p^j}\right\rfloor } $$

这里 $p$ 必须是质数。

人话计算式：

$$ \boxed{ \left\lfloor\frac np\right\rfloor+ \left\lfloor\frac n{p^2}\right\rfloor+ \left\lfloor\frac n{p^3}\right\rfloor+\cdots } $$

怎么算： 依次除以 $p,p^2,p^3,\ldots$，每次向下取整并相加，直到商小于 1。

### D20. 阶乘末尾零（Trailing Zeros）

十进制下：

$$ \boxed{ Z(n!)= \left\lfloor\frac n5\right\rfloor+ \left\lfloor\frac n{25}\right\rfloor+ \left\lfloor\frac n{125}\right\rfloor+\cdots } $$

怎么算： 计算 $n!$ 中因数 5 的总指数，因为因数 2 的数量总是足够多。

### D21. 进制（Number Bases）

$$ \boxed{ (a_na_{n-1}\cdots a_0)_b =\sum_{i=0}^{n}a_i b^i } $$

其中：

- $b$：进制，整数且 $b\ge2$。
- $a_i$：各位数字，满足 $0\le a_i<b$。

怎么算： 从最右侧开始，将数字分别乘 $b^0,b^1,b^2,\ldots$，再相加。

反过来由十进制转换为 $b$ 进制，可以不断除以 $b$，记录余数，最后倒序排列。

### D22. 数位和（Digit Sum）

设十进制整数 $N$ 的数位之和为 $S$：

$$ \boxed{N\equiv S\pmod9} $$

$$ \boxed{N\equiv S\pmod3} $$

怎么算： 把每一位数字相加，再判断所得和对 3 或 9 的余数。

### D23. 数位倒序（Reversed Digits）

三位数：

$$ \boxed{N=100a+10b+c} $$

倒序：

$$ \boxed{R=100c+10b+a} $$

所以：

$$ \boxed{N-R=99(a-c)} $$

怎么算： 将每一位的数字乘对应的位值，按原顺序和倒序分别写出表达式后相减。

### D24. 线性整数方程（Linear Diophantine Equations）

对于整数 $a,b,c$，且 $a,b$ 不同时为零：

$$ \boxed{ax+by=c} $$

存在整数解的充要条件：

$$ \boxed{\gcd(a,b)\mid c} $$

怎么算： 先求 GCD，判断它能否整除 $c$。如果可以，再利用余数、代入或辗转相除法寻找整数解。

若要求正整数或非负整数解，还需要额外检查范围。

### D25. 倍数计数（Counting Multiples）

$$ \boxed{ M(1,N;k)=\left\lfloor\frac Nk\right\rfloor } $$

$$ \boxed{ M(A,B;k)= \left\lfloor\frac Bk\right\rfloor- \left\lfloor\frac{A-1}{k}\right\rfloor } $$

这里 $A,B,k$ 都是正整数，$A\le B$。

怎么算： 求区间上界之前的倍数数量，减去区间下界之前的倍数数量。

## E. 组合计数（Combinatorics）

### E1. 加法原理（Addition Principle）

$$ \boxed{N=N_1+N_2+\cdots+N_k} $$

怎么算： 将所有互不重叠的情况分别计数，再相加。

如果情况有重叠，必须使用容斥原理修正。

### E2. 乘法原理（Multiplication Principle）

$$ \boxed{N=N_1N_2\cdots N_k} $$

怎么算： 将过程拆成若干步，统计每一步的选择数，再相乘。

这里要求对应的分步计数正确；如果每步选择数取决于之前的选择，需要进一步分类。

### E3. 排列（Permutations）

$$ \boxed{P(n,r)=\frac{n!}{(n-r)!}} $$

怎么算： 从 $n$ 个不同对象中选 $r$ 个，顺序重要、不允许重复。

直接计算：

$$ \boxed{n(n-1)\cdots(n-r+1)} $$

共 $r$ 个因数。

### E4. 组合（Combinations）

$$ \boxed{\binom nr=\frac{n!}{r!(n-r)!}} $$

怎么算： 从 $n$ 个不同对象中选 $r$ 个，顺序不重要、不允许重复。

可以先计算排列数量，再除以 $r!$，消除同一组元素的不同排列顺序。

### E5. 可重复选择（Selections with Repetition）

从 $n$ 种不同类型中选择 $r$ 次：

如果顺序重要：

$$ \boxed{n^r} $$

如果顺序不重要：

$$ \boxed{\binom{n+r-1}{r}} $$

怎么算：

- 顺序重要：每个位置都有 $n$ 种选择。
- 顺序不重要：使用隔板法计算各类型分别选取多少个。

### E6. 相同元素排列（Permutations of Identical Objects）

若总共 $n$ 个对象，其中各类相同对象分别有 $a_1,a_2,\ldots,a_k$ 个：

$$ \boxed{ N=\frac{n!}{a_1!a_2!\cdots a_k!} } $$

要求：

$$ a_1+\cdots+a_k=n $$

怎么算： 先计算所有对象互不相同时的排列数，再除以各组相同对象内部的排列数。

### E7. 圆形排列（Circular Permutations）

$n$ 个不同对象围成一个圆，仅旋转视为相同：

$$ \boxed{(n-1)!} $$

如果旋转和翻面都视为相同，且 $n\ge3$：

$$ \boxed{\frac{(n-1)!}{2}} $$

怎么算： 固定一个对象消除旋转重复；如果翻面也相同，再除以 2。

### E8. 隔板法（Stars and Bars）

求非负整数解：

$$ x_1+x_2+\cdots+x_k=n,\qquad x_i\ge0 $$

$$ \boxed{N=\binom{n+k-1}{k-1}} $$

求正整数解：

$$ x_1+x_2+\cdots+x_k=n,\qquad x_i\ge1 $$

$$ \boxed{N=\binom{n-1}{k-1}} $$

怎么算：

- 允许为 0：把 $n$ 个相同物品与 $k-1$ 个隔板进行排列。
- 每个至少 1：先给每组一个物品，再用允许为 0 的公式。

如果各变量还有不同的最小值 $L_i$，可以先令 $y_i=x_i-L_i$，再使用非负整数解公式。

### E9. 容斥原理（Inclusion–Exclusion Principle）

两个集合：

$$ \boxed{|A\cup B|=|A|+|B|-|A\cap B|} $$

三个集合：

$$ \boxed{ \begin{aligned} |A\cup B\cup C| ={}&|A|+|B|+|C|\\ &-|A\cap B|-|A\cap C|-|B\cap C|\\ &+|A\cap B\cap C| \end{aligned} } $$

怎么算： 单个集合加起来，两个集合的交集减掉，三个集合的交集加回来；更多集合继续交替加减。

### E10. 补集计数（Complementary Counting）

$$ \boxed{N_{\mathrm{wanted}}=N_{\mathrm{total}}-N_{\mathrm{unwanted}}} $$

怎么算： 先计算所有情况，再减去不满足要求的情况。

### E11. 捆绑法（Block Method）

若 $k$ 个指定的不同对象必须相邻，且总共有 $n$ 个不同对象：

$$ \boxed{N=(n-k+1)!\,k!} $$

怎么算： 将指定的 $k$ 个对象视为一个整体，排列剩余的 $n-k+1$ 个单位，再乘内部的 $k!$ 种排列方式。

这个公式仅适用于没有其他额外限制的线性排列。

### E12. 网格路径（Lattice Paths）

只能向右走 $m$ 步、向上走 $n$ 步：

$$ \boxed{N=\binom{m+n}{m}} $$

怎么算： 总共 $m+n$ 步，从中选 $m$ 个位置作为向右的步骤，其余自动向上。

必须经过某点 P：

$$ \boxed{N=N_{\mathrm{start}\to P}N_{P\to\mathrm{end}}} $$

禁止经过某点 P：

$$ \boxed{N_{\mathrm{allowed}}=N_{\mathrm{total}}-N_{\mathrm{through}\ P}} $$

前提是目标点和中间点满足移动方向要求。

### E13. 鸽巢原理（Pigeonhole Principle）

把 $N$ 个对象分进 $k$ 个类别：

$$ \boxed{ \text{某类别至少包含 } \left\lceil\frac Nk\right\rceil \text{ 个对象} } $$

怎么算： 总对象数除以类别数，向上取整。

如果要保证至少有一个类别包含 $r$ 个对象：

$$ \boxed{N_{\min}=k(r-1)+1} $$

怎么算： 先让每个类别最多有 $r-1$ 个，再增加一个对象。

### E14. 递推关系（Recurrence Relations）

$$ \boxed{a_n=f(a_{n-1},a_{n-2},\ldots)} $$

怎么算： 把规模为 $n$ 的问题分解成更小规模的问题，然后根据初始条件逐项计算。

常见 Fibonacci 递推：

$$ \boxed{F_n=F_{n-1}+F_{n-2}} $$

但起始项必须根据题目的定义确定。

### E15. 错位排列（Derangements）

$n$ 个不同对象排列，要求没有对象回到原来的位置：

$$ \boxed{ D_n=n!\sum_{k=0}^{n}\frac{(-1)^k}{k!} } $$

展开：

$$ \boxed{ D_n=n!\left(1-\frac1{1!}+\frac1{2!} -\frac1{3!}+\cdots+\frac{(-1)^n}{n!}\right) } $$

怎么算： 先求全部 $n!$ 种排列，再用容斥原理排除存在固定位置的排列。

递推形式：

$$ \boxed{D_n=(n-1)(D_{n-1}+D_{n-2})} $$

初始值：

$$ D_0=1,\qquad D_1=0 $$

### E16. 握手引理（Handshake Lemma）

在无向图中：

$$ \boxed{\sum_{v\in V}\deg(v)=2E} $$

其中：

- $\deg(v)$：顶点 $v$ 的度数，即连接到它的边数。
- $E$：边的总数。

怎么算： 将每个顶点连接的边数相加，再除以 2，得到边数。

如果 $n$ 个对象两两连接且没有重复：

$$ \boxed{E=\binom n2=\frac{n(n-1)}2} $$

### E17. 直线交点（Line Intersections）

$n$ 条不同直线，任意两条不平行、任意三条不共点：

$$ \boxed{I=\binom n2} $$

怎么算： 从所有直线中选择两条，每一对产生一个不同交点。

### E18. 圆内弦交点（Circle Chord Intersections）

圆周上有 $n$ 个不同点，连接任意两点，且任意三条弦不在圆内同一点相交：

$$ \boxed{I=\binom n4} $$

怎么算： 每四个圆周点确定一组在圆内相交的两条弦，因此从 $n$ 个点中选择四个。

## F. 概率与统计（Probability & Statistics）

### F1. 古典概率（Classical Probability）

当所有基本结果等可能：

$$ \boxed{P(A)=\frac{N(A)}{N(S)}} $$

其中：

- $N(A)$：符合事件 A 的结果数。
- $N(S)$：所有可能的基本结果数。

怎么算： 先算符合要求的结果数量，再除以总结果数。

### F2. 补事件概率（Complement Rule）

$$ \boxed{P(A^c)=1-P(A)} $$

怎么算： 用 1 减去相反事件发生的概率。

### F3. 概率加法法则（Addition Rule）

$$ \boxed{P(A\cup B)=P(A)+P(B)-P(A\cap B)} $$

如果 A、B 互斥：

$$ \boxed{P(A\cup B)=P(A)+P(B)} $$

怎么算： 两个事件概率相加，再减去重复计入的交集概率。

### F4. 概率乘法法则（Multiplication Rule）

$$ \boxed{P(A\cap B)=P(A)P(B\mid A)} $$

如果 A、B 独立：

$$ \boxed{P(A\cap B)=P(A)P(B)} $$

怎么算： 将第一事件的概率，乘上第一事件发生后第二事件的条件概率。

独立时，第二事件概率不受第一事件影响。

### F5. 条件概率（Conditional Probability）

$$ \boxed{P(A\mid B)=\frac{P(A\cap B)}{P(B)}} $$

要求 $P(B)>0$。

怎么算： 已知 B 发生后，只在 B 对应的可能情况中，计算其中满足 A 的比例。

### F6. 二项概率（Binomial Probability）

$$ \boxed{ P(X=k)=\binom nk p^k(1-p)^{n-k} } $$

其中：

- $n$：独立试验次数。
- $k$：要求的成功次数。
- $p$：每次成功概率。
- $X$：总成功次数。

怎么算：

1. 计算选择 $k$ 次成功位置的方法数。
2. 乘 $k$ 次成功的概率。
3. 再乘其余 $n-k$ 次失败的概率。

要求每次试验相互独立，且成功概率相同。

### F7. 超几何概率（Hypergeometric Probability）

从 $N$ 个不同对象中不放回抽取 $n$ 个，其中有 $K$ 个目标对象，要求恰好抽到 $k$ 个目标对象：

$$ \boxed{ P(X=k)= \frac{\binom Kk\binom{N-K}{n-k}}{\binom Nn} } $$

怎么算： 分别从目标类和非目标类选取所需数量，将两种组合数相乘，再除以总选法数量。

### F8. 期望值（Expected Value）

$$ \boxed{E(X)=\sum_i x_iP(X=x_i)} $$

怎么算： 每种可能结果乘对应概率，然后全部相加。

期望的线性性质：

$$ \boxed{E(X+Y)=E(X)+E(Y)} $$

即使两个随机变量不独立也成立。

### F9. 几何概率（Geometric Probability）

在均匀随机选择的条件下：

$$ \boxed{ P(A)=\frac{\text{Favourable Area}}{\text{Total Area}} } $$

如果随机点沿线段长度均匀分布：

$$ \boxed{ P(A)=\frac{\text{Favourable Length}}{\text{Total Length}} } $$

怎么算： 先确定随机选择的基本对象是面积、长度还是其他测度，再计算有利部分与整体的比例。

### F10. 平均数、中位数、众数与极差（Mean, Median, Mode & Range）

平均数：

$$ \boxed{\bar x=\frac{\sum x_i}{n}} $$

极差：

$$ \boxed{R=x_{\max}-x_{\min}} $$

怎么算：

- Mean：求和后除以数量。
- Median：排序后取中间位置；若数据个数为偶数，取中间两个数的平均。
- Mode：找出现频率最高的数据。
- Range：最大值减最小值。

## G. 平面几何（Plane Geometry）

### G1. 基本角度（Basic Angle Rules）

平角：

$$ \boxed{180^\circ} $$

周角：

$$ \boxed{360^\circ} $$

对顶角：

$$ \boxed{\angle1=\angle2} $$

怎么算： 根据直线、交叉直线及平行线的角度关系，建立角度相等或互补的方程。

平行线被截线所截时：

- Corresponding Angles（同位角）相等。
- Alternate Interior Angles（内错角）相等。
- Co-interior Angles（同旁内角）之和为 $180^\circ$。

### G2. 三角形内角和（Triangle Angle Sum）

$$ \boxed{A+B+C=180^\circ} $$

外角定理：

$$ \boxed{\text{Exterior Angle}=A+B} $$

其中 A、B 是与该外角不相邻的两个内角。

怎么算： 已知两个内角就用 180° 减去它们；已知远端两个内角，直接相加得到对应外角。

### G3. 等腰与等边三角形（Isosceles & Equilateral Triangles）

等腰三角形两条边相等时，对应底角相等。

等边三角形：

$$ \boxed{A=B=C=60^\circ} $$

边长 $a$，高：

$$ \boxed{h=\frac{\sqrt3}{2}a} $$

面积：

$$ \boxed{S=\frac{\sqrt3}{4}a^2} $$

怎么算： 将等边三角形通过高分成两个 30°–60°–90° 直角三角形，利用边长比例求高和面积。

### G4. 三角形不等式（Triangle Inequality）

$$ \boxed{|a-b|<c<a+b} $$

其中 $a,b,c>0$。

怎么算： 已知两边，第三边必须大于两边之差的绝对值、小于两边之和。

如果第三边限定为整数，只需要在这个开区间内数整数。

### G5. 勾股定理（Pythagorean Theorem）

直角三角形：

$$ \boxed{a^2+b^2=c^2} $$

其中 $c$ 是斜边。

怎么算： 已知任意两边，利用平方和或平方差求第三边。

常见整数边组合：

| 直角边   | 斜边 |
| ----- | -- |
| 3、4   | 5  |
| 5、12  | 13 |
| 8、15  | 17 |
| 7、24  | 25 |
| 9、40  | 41 |
| 20、21 | 29 |

这些比例的整数倍也满足勾股定理。

### G6. 特殊直角三角形（Special Right Triangles）

45°–45°–90°

$$ \boxed{1:1:\sqrt2} $$

30°–60°–90°

$$ \boxed{1:\sqrt3:2} $$

怎么算： 根据三角形角度识别对应的三条边，把给定边长作为比例单位，再计算其他边长。

### G7. 三角形面积（Triangle Area）

$$ \boxed{S=\frac12 bh} $$

其中：

- $b$：底边。
- $h$：对应底边的垂直高度。

怎么算： 底乘高再除以 2。

同高三角形：

$$ \boxed{\frac{S_1}{S_2}=\frac{b_1}{b_2}} $$

同底三角形：

$$ \boxed{\frac{S_1}{S_2}=\frac{h_1}{h_2}} $$

### G8. 海伦公式（Heron's Formula）

$$ \boxed{s=\frac{a+b+c}{2}} $$

$$ \boxed{S=\sqrt{s(s-a)(s-b)(s-c)}} $$

其中 $s$ 是半周长。

怎么算： 已知三边长度，先求半周长，再计算四个因数的乘积，最后开平方。

### G9. 相似三角形（Similar Triangles）

如果两三角形相似，且对应边长比例为 $k$：

$$ \boxed{\frac{a_1}{a_2}=k} $$

$$ \boxed{\frac{S_1}{S_2}=k^2} $$

怎么算： 用对应边的比例计算其他边；如果求面积比，就把边长比平方。

相似判定：

- AA：两个对应角相等。
- SAS：两组对应边成比例，夹角相等。
- SSS：三组对应边成比例。

### G10. 全等三角形（Congruent Triangles）

常见判定为 SSS、SAS、ASA、AAS、RHS/HL。

怎么算： 根据对应边、对应角是否相等判断全等；一旦全等，所有对应边、对应角以及面积都相等。

### G11. 角平分线定理（Angle Bisector Theorem）

三角形 $ABC$ 中，$AD$ 平分 $\angle A$，且 $D$ 位于 $BC$ 上：

$$ \boxed{\frac{BD}{DC}=\frac{AB}{AC}} $$

怎么算： 利用两条邻边的比，得到对边被角平分线分出的两段长度比，再结合 $BD+DC=BC$ 求具体长度。

### G12. 中线与重心（Median & Centroid）

如果 $AD$ 是三角形中线，$G$ 是重心：

$$ \boxed{AG:GD=2:1} $$

因此：

$$ \boxed{AG=\frac23AD} \qquad \boxed{GD=\frac13AD} $$

怎么算： 将中线长度分成 3 份，从顶点到重心占 2 份，从重心到对边中点占 1 份。

中线将三角形面积平分：

$$ \boxed{S_1=S_2} $$

### G13. 内心与内切圆（Incenter & Inradius）

$$ \boxed{S=rs} $$

其中：

- $r$：内切圆半径。
- $s$：三角形半周长。
- $S$：三角形面积。

怎么算： 用面积除以半周长求内切圆半径，或者用半径乘半周长求面积。

### G14. 外心与外接圆（Circumcenter & Circumradius）

$$ \boxed{S=\frac{abc}{4R}} $$

所以：

$$ \boxed{R=\frac{abc}{4S}} $$

其中：

- $a,b,c$：三边。
- $R$：外接圆半径。
- $S$：面积。

怎么算： 已知三边和面积，将三边连乘再除以四倍面积。

对于直角三角形：

$$ \boxed{R=\frac c2} $$

这里 $c$ 为斜边。

### G15. 直角三角形斜边上的高（Right Triangle Altitude Theorem）

如果斜边为 $c$，被高 $h$ 分成 $m,n$：

$$ \boxed{c=m+n} $$

$$ \boxed{h^2=mn} $$

两条直角边 $a,b$ 分别对应投影 $m,n$：

$$ \boxed{a^2=cm} $$

$$ \boxed{b^2=cn} $$

怎么算： 直接用相似三角形对应边比例建立平方关系，求高或直角边长度。

### G16. 四边形（Quadrilaterals）

| 图形                  | 公式                    | 计算方法             |
| ------------------- | --------------------- | ---------------- |
| Rectangle 长方形       | $S=lw$            | 长乘宽              |
| Rectangle Perimeter | $P=2(l+w)$        | 长宽之和乘 2          |
| Square 正方形          | $S=a^2$           | 边长平方             |
| Square Diagonal     | $d=a\sqrt2$       | 边长乘 $\sqrt2$ |
| Parallelogram 平行四边形 | $S=bh$            | 底乘垂直高            |
| Trapezoid 梯形        | $S=\frac12(a+b)h$ | 上下底之和乘高再除以 2     |
| Rhombus 菱形          | $S=\frac12d_1d_2$ | 两条对角线之积除以 2      |

其中 $l,w$ 是长宽，$b,h$ 是底和垂直高，$d_i$ 是对角线长度。

### G17. 多边形角度（Polygon Angle Sum）

$n$ 边形内角和：

$$ \boxed{(n-2)180^\circ} $$

正 $n$ 边形每个内角：

$$ \boxed{\frac{(n-2)180^\circ}{n}} $$

正 $n$ 边形每个外角：

$$ \boxed{\frac{360^\circ}{n}} $$

怎么算： 根据边数 $n$，代入对应公式。凸多边形每个顶点各取一个同向外角时，外角和为 $360^\circ$。

### G18. 多边形对角线（Polygon Diagonals）

$$ \boxed{D=\frac{n(n-3)}2} $$

怎么算： 每个顶点能向其余 $n-3$ 个非相邻顶点连对角线，乘顶点数 $n$，再除以 2，消除重复计数。

### G19. 正多边形面积（Regular Polygon Area）

$$ \boxed{S=\frac12Pa} $$

其中：

- $P$：周长。
- $a$：Apothem，边心距，即中心到一条边的垂直距离。

怎么算： 周长乘边心距再除以 2。

正六边形边长为 $s$：

$$ \boxed{S=\frac{3\sqrt3}{2}s^2} $$

### G20. 圆（Circle）

周长：

$$ \boxed{C=2\pi r} $$

面积：

$$ \boxed{S=\pi r^2} $$

直径：

$$ \boxed{d=2r} $$

怎么算： 根据半径直接计算。

### G21. 弧长（Arc Length）

当圆心角为 $\theta^\circ$：

$$ \boxed{L=\frac{\theta}{360^\circ}2\pi r} $$

怎么算： 用圆心角除以 360°，计算弧占整圆的比例，再乘整圆周长。

### G22. 扇形面积（Sector Area）

$$ \boxed{S_{\mathrm{sector}}=\frac{\theta}{360^\circ}\pi r^2} $$

怎么算： 用圆心角占 360° 的比例乘整圆面积。

弓形面积：

$$ \boxed{S_{\mathrm{segment}}=S_{\mathrm{sector}}-S_{\mathrm{triangle}}} $$

圆环面积：

$$ \boxed{S_{\mathrm{annulus}}=\pi(R^2-r^2)} $$

### G23. 圆周角定理（Inscribed Angle Theorem）

对同一条弧：

$$ \boxed{\theta_{\mathrm{inscribed}}=\frac12\theta_{\mathrm{central}}} $$

怎么算： 圆心角除以 2 得到同弧所对的圆周角。

半圆所对圆周角：

$$ \boxed{90^\circ} $$

### G24. 圆内接四边形（Cyclic Quadrilaterals）

对于圆内接四边形 $ABCD$：

$$ \boxed{A+C=180^\circ} $$

$$ \boxed{B+D=180^\circ} $$

怎么算： 已知某个内角，直接用 $180^\circ$ 减它，得到对角。

### G25. 切线（Tangents）

切点处的半径与切线垂直：

$$ \boxed{OT\perp PT} $$

从同一个圆外点 P 作两条切线 PA、PB：

$$ \boxed{PA=PB} $$

怎么算： 使用垂直关系建立直角三角形，或利用同点切线长度相等的性质。

### G26. 弦长（Chord Length）

半径为 $r$，圆心到弦的垂直距离为 $d$：

$$ \boxed{L=2\sqrt{r^2-d^2}} $$

怎么算： 将弦平分为两段，通过勾股定理求半弦长度，再乘 2。

### G27. 相交弦定理（Intersecting Chords Theorem）

圆内两条弦 $AB,CD$ 交于 P：

$$ \boxed{PA\cdot PB=PC\cdot PD} $$

怎么算： 将每条弦在交点两侧的长度相乘，再令两组乘积相等。

### G28. 点的幂（Power of a Point）

两条割线从圆外同一点 P 出发：

$$ \boxed{PA\cdot PB=PC\cdot PD} $$

其中 A、C 是各自较近的圆上交点，B、D 是较远的交点。

切线 PT 与割线 PAB：

$$ \boxed{PT^2=PA\cdot PB} $$

怎么算： 用圆外部分长度乘从 P 到远端交点的完整长度；如果是切线，则用切线长度的平方。

### G29. 圆中的交角（Circle Intersection Angles）

两弦在圆内相交：

$$ \boxed{\theta=\frac{\alpha+\beta}{2}} $$

两条割线在圆外相交：

$$ \boxed{\theta=\frac{\alpha-\beta}{2}} $$

其中 $\alpha,\beta$ 为对应截弧的度数，第二个公式取远弧减近弧。

怎么算： 根据交点在圆内还是圆外，选择弧度数的和或差，再除以 2。

## H. 坐标几何（Coordinate Geometry）

### H1. 两点距离（Distance Formula）

$$ \boxed{ d=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2} } $$

怎么算： 横坐标之差平方，加纵坐标之差平方，最后开平方。

### H2. 中点（Midpoint Formula）

$$ \boxed{ M=\left(\frac{x_1+x_2}{2},\frac{y_1+y_2}{2}\right) } $$

怎么算： 两个横坐标取平均，两个纵坐标取平均。

### H3. 斜率（Slope）

$$ \boxed{m=\frac{y_2-y_1}{x_2-x_1}} $$

要求 $x_1\ne x_2$。

怎么算： 纵坐标变化量除以横坐标变化量。

### H4. 直线方程（Equations of Lines）

斜截式：

$$ \boxed{y=mx+c} $$

点斜式：

$$ \boxed{y-y_1=m(x-x_1)} $$

平行条件（非竖直直线）：

$$ \boxed{m_1=m_2} $$

垂直条件（两条斜率均存在）：

$$ \boxed{m_1m_2=-1} $$

怎么算： 已知一点和斜率，用点斜式；已知两点，先计算斜率，再代入其中一个点。

### H5. 坐标三角形面积（Triangle Area from Coordinates）

$$ \boxed{ S=\frac12\left| x_1(y_2-y_3)+x_2(y_3-y_1)+x_3(y_1-y_2) \right| } $$

怎么算： 按公式交叉相乘并求和，最后取绝对值除以 2。

### H6. 鞋带公式（Shoelace Formula）

对于按边界顺序排列的多边形顶点：

$$ (x_1,y_1),\ldots,(x_n,y_n) $$

规定：

$$ x_{n+1}=x_1,\qquad y_{n+1}=y_1 $$

面积：

$$ \boxed{ S=\frac12\left| \sum_{i=1}^n x_i y_{i+1} - \sum_{i=1}^n y_i x_{i+1} \right| } $$

怎么算： 一组按顺序交叉相乘求和，另一组反向交叉相乘求和，两组相减后取绝对值，再除以 2。

### H7. 皮克定理（Pick's Theorem）

适用于顶点位于整数格点上的简单多边形：

$$ \boxed{S=I+\frac B2-1} $$

其中：

- $I$：多边形严格内部的格点数量。
- $B$：多边形边界上的格点数量。

怎么算： 数内部格点，加上边界格点的一半，再减 1。

### H8. 坐标变换（Coordinate Transformations）

| 变换             | 新坐标             |
| -------------- | --------------- |
| 关于 x 轴反射       | $(x,-y)$    |
| 关于 y 轴反射       | $(-x,y)$    |
| 关于原点反射         | $(-x,-y)$   |
| 逆时针旋转 90°      | $(-y,x)$    |
| 顺时针旋转 90°      | $(y,-x)$    |
| 旋转 180°        | $(-x,-y)$   |
| 平移 $(a,b)$ | $(x+a,y+b)$ |

旋转均以原点为中心。

## I. 立体几何（Solid Geometry）

### I1. 正方体（Cube）

边长 $a$：

$$ \boxed{V=a^3} $$

$$ \boxed{S=6a^2} $$

空间对角线：

$$ \boxed{d=a\sqrt3} $$

怎么算： 边长三次方求体积，六个相同正方形面积相加求表面积，空间对角线使用三维勾股关系。

### I2. 长方体（Rectangular Prism）

$$ \boxed{V=lwh} $$

$$ \boxed{S=2(lw+lh+wh)} $$

$$ \boxed{d=\sqrt{l^2+w^2+h^2}} $$

其中 $l,w,h$ 分别是长、宽、高。

### I3. 圆柱（Cylinder）

$$ \boxed{V=\pi r^2h} $$

$$ \boxed{S=2\pi r^2+2\pi rh} $$

怎么算： 底面积乘高得到体积；两个圆形底面面积加侧面积得到完整表面积。

### I4. 圆锥（Cone）

$$ \boxed{V=\frac13\pi r^2h} $$

侧面积：

$$ \boxed{S_{\mathrm{lateral}}=\pi rl} $$

对于直圆锥：

$$ \boxed{l=\sqrt{r^2+h^2}} $$

其中 $l$ 是母线长。

完整表面积：

$$ \boxed{S=\pi r^2+\pi rl} $$

### I5. 球（Sphere）

$$ \boxed{V=\frac43\pi r^3} $$

$$ \boxed{S=4\pi r^2} $$

怎么算： 半径的三次方乘 $4\pi/3$ 求体积，半径平方乘 $4\pi$ 求表面积。

### I6. 棱柱与棱锥（Prism & Pyramid）

棱柱：

$$ \boxed{V=S_{\mathrm{base}}h} $$

棱锥：

$$ \boxed{V=\frac13S_{\mathrm{base}}h} $$

怎么算： 底面积乘垂直高度；如果是棱锥，再除以 3。

### I7. 相似立体（Similar Solids）

对应长度比为 $k$：

$$ \boxed{\frac{S_1}{S_2}=k^2} $$

$$ \boxed{\frac{V_1}{V_2}=k^3} $$

怎么算： 面积比是长度比的平方，体积比是长度比的立方。

### I8. 欧拉多面体公式（Euler's Polyhedron Formula）

对于凸多面体：

$$ \boxed{V-E+F=2} $$

其中：

- $V$：顶点数量。
- $E$：棱数量。
- $F$：面数量。

怎么算： 将已知的两个数量代入公式，解出第三个数量。

## J. 其他数学技巧（Other Mathematical Techniques）

### J1. 奇偶性（Parity）

偶数：

$$ \boxed{2k} $$

奇数：

$$ \boxed{2k+1} $$

其中 $k\in\mathbb Z$。

怎么算： 用整数的奇偶表示法，把运算结果整理成 $2m$ 或 $2m+1$，判断结果的奇偶性。

### J2. 不变量（Invariants）

如果操作始终让一个数改变 $km$，则：

$$ \boxed{N_{\mathrm{new}}\equiv N_{\mathrm{old}}\pmod m} $$

怎么算： 寻找每次操作都不会改变的余数、奇偶性、颜色数量差或其他量，用来判断某个结果能否出现。

### J3. 上下界（Bounds）

$$ \boxed{L\le x\le U} $$

其中 $L$ 为下界，$U$ 为上界。

怎么算： 利用非负性、大小比较、单调性或不等式建立范围，再与选项或整数条件比较。

### J4. 对称代数式（Symmetric Expressions）

已知：

$$ s=a+b,\qquad p=ab $$

则：

$$ \boxed{a^2+b^2=s^2-2p} $$

$$ \boxed{a^3+b^3=s^3-3ps} $$

$$ \boxed{(a-b)^2=s^2-4p} $$

怎么算： 用两个数的和与积表示较高次的代数式，避免先求出 $a,b$。

### J5. 时钟夹角（Clock Angles）

使用 12 小时制，令 $h\in\{0,1,\ldots,11\}$，$m$ 为分钟数：

时针角度：

$$ \boxed{\theta_h=30h+0.5m} $$

分针角度：

$$ \boxed{\theta_m=6m} $$

角度差：

$$ \boxed{\Delta=|30h-5.5m|} $$

最小夹角：

$$ \boxed{\theta=\min(\Delta,360^\circ-\Delta)} $$

怎么算： 分别计算两根指针相对于 12 点方向的角度，求差，再取较小的夹角。

### J6. 双重计数（Double Counting）

核心关系：

$$ \boxed{\text{Count by Method A}=\text{Count by Method B}} $$

怎么算： 从两个不同角度统计同一批对象或关系，建立等式求未知量。

常见形式：

$$ \boxed{\sum\deg(v)=2E} $$

### J7. 多个非负数的算术—几何平均不等式（AM–GM for Multiple Numbers）

对于非负实数 $x_1,\ldots,x_n$：

$$ \boxed{ \frac{x_1+\cdots+x_n}{n} \ge\sqrt[n]{x_1x_2\cdots x_n} } $$

怎么算： 当非负变量之和固定时，可以用这个不等式求乘积上界；乘积为固定正数时，可求和的下界。

等号成立当所有变量相等。

# 第二部分：如何判断使用哪个公式

这一部分按照题目中的英文关键词、已知条件和所求量分类。

同一个关键词可能对应多种公式，必须结合题目的实际限制判断。

## 1. 算术与代数（Arithmetic & Algebra）

| 题目条件 / English Keywords             | 判断方法        | 使用公式                            |
| ----------------------------------- | ----------- | ------------------------------- |
| percentage increase / decrease      | 按比例增加或减少    | $N=O(1+r)$                  |
| average / mean                      | 已知总数和数量     | $\bar x=\frac{\sum x_i}{n}$ |
| combined average                    | 多组数据人数不同    | Weighted Average                |
| average speed                       | 总路程与总时间     | $v=\frac dt$                |
| same distance, different speeds     | 等距离往返       | $\frac{2ab}{a+b}$           |
| working together                    | 多人同时完成工作    | $\frac1T=\frac1a+\frac1b$   |
| concentration / mixture             | 多种浓度混合      | 溶质总量除以混合物总量                     |
| constant difference                 | 相邻项差固定      | Arithmetic Sequence             |
| constant ratio                      | 相邻项比固定      | Geometric Sequence              |
| sum of consecutive integers         | 连续整数求和      | $\frac{n(n+1)}2$            |
| sum of squares                      | 连续整数平方求和    | $\frac{n(n+1)(2n+1)}6$      |
| sum of cubes                        | 连续整数立方求和    | $[\frac{n(n+1)}2]^2$        |
| fractional terms cancel             | 相邻分数可裂项相消   | Telescoping Sum                 |
| roots of a quadratic                | 需要求根        | Quadratic Formula               |
| sum/product of roots                | 只需要根的和或积    | Vieta's Formulas                |
| maximum / minimum of a quadratic    | 二次函数极值      | Completing the Square           |
| fixed sum, maximum product          | 非负变量的和固定    | AM–GM                           |
| fixed positive product, minimum sum | 正变量的积固定     | AM–GM                           |
| distance from a number              | 数轴上的距离      | Absolute Value                  |
| coefficient of a term               | 二项式展开的指定项系数 | Binomial Theorem                |
| exponential growth                  | 每周期固定比例增长   | Compound Growth                 |

## 2. 数论（Number Theory）

| 题目条件 / English Keywords               | 判断方法          | 使用公式                                |
| ------------------------------------- | ------------- | ----------------------------------- |
| prime number                          | 判断质数          | 检查不超过 $\sqrt N$ 的质因数            |
| prime factorisation                   | 质因数分解         | $N=\prod p_i^{a_i}$             |
| number of positive divisors / factors | 正约数个数         | $\prod(a_i+1)$                  |
| sum of all factors                    | 正约数之和         | $\prod(1+p_i+\cdots+p_i^{a_i})$ |
| product of all factors                | 正约数乘积         | $N^{d(N)/2}$                    |
| greatest common divisor               | 最大公因数         | GCD / Euclidean Algorithm           |
| least common multiple                 | 最小公倍数         | LCM                                 |
| relatively prime / coprime            | 两数互质          | $\gcd(a,b)=1$                   |
| how many numbers are coprime to n     | 1 到 n 之间的互质计数 | Euler's Totient Function            |
| remainder when divided by             | 求余数           | Modular Arithmetic                  |
| last digit                            | 求个位           | Modulo 10                           |
| last two digits                       | 求末两位          | Modulo 100                          |
| large integer powers                  | 高次幂求余数        | Powers Cycle / Fermat / Euler       |
| trailing zeros of n!                  | 阶乘末尾零         | Legendre's Formula                  |
| perfect square                        | 判断完全平方        | 所有质因数指数为偶数                          |
| perfect cube                          | 判断完全立方        | 所有质因数指数为 3 的倍数                      |
| number of square divisors             | 完全平方约数个数      | $\prod(\lfloor a_i/2\rfloor+1)$ |
| integer solutions                     | 整数方程          | GCD / Modular Arithmetic            |
| multiples between A and B             | 区间倍数数量        | Floor Function                      |
| binary / base-n                       | 进制问题          | Positional Number Formula           |
| sum of digits                         | 数位和与整除        | Modulo 3 / 9                        |
| reversed digits                       | 倒序数字          | 位值展开                                |

## 3. 组合计数（Counting）

先判断顺序是否重要，再判断是否允许重复选择：

| 顺序重要 | 允许重复 | 公式 | 适用情况 |
| --- | --- | --- | --- |
| 是 | 否 | $P(n,r)=\frac{n!}{(n-r)!}$ | 从 $n$ 个不同对象中选 $r$ 个，顺序重要且不能重复 |
| 是 | 是 | $n^r$ | 每次有 $n$ 种选择，共选择 $r$ 次，顺序重要且可以重复 |
| 否 | 否 | $\binom nr$ | 从 $n$ 个不同对象中选 $r$ 个，不计顺序且不能重复 |
| 否 | 是 | $\binom{n+r-1}{r}$ | 从 $n$ 种对象中选 $r$ 个，不计顺序且可以重复 |

此判断适用于没有额外相邻、位置、数量上下限等限制的基本选择问题。

其他计数问题：

| English Keywords / 条件          | 判断方法        | 使用公式                             |
| ------------------------------ | ----------- | -------------------------------- |
| identical objects              | 存在不可区分的相同对象 | Repeated Permutations            |
| around a round table           | 圆形排列，旋转等价   | $(n-1)!$                     |
| necklace, flipping allowed     | 圆环翻面也等价     | $(n-1)!/2$，需满足对象互不相同等条件      |
| distribute identical items     | 相同物品分给不同组   | Stars and Bars                   |
| nonnegative integer solutions  | 非负整数分配      | $\binom{n+k-1}{k-1}$         |
| positive integer solutions     | 每个变量至少为 1   | $\binom{n-1}{k-1}$           |
| at least one                   | 至少出现一次      | Complementary Counting           |
| neither A nor B                | 两类都不满足      | Complement / Inclusion–Exclusion |
| both A and B                   | 两类交集        | Intersection                     |
| adjacent / together            | 指定对象必须相邻    | Block Method                     |
| not adjacent                   | 指定对象不能相邻    | Total − Adjacent                 |
| grid paths                     | 固定方向的格点路径   | Lattice Paths                    |
| must pass through              | 必须经过某点      | 两段路径数量相乘                         |
| cannot pass through            | 不得经过某点      | 总路径减经过该点的路径                      |
| guaranteed / must occur        | 无论如何都保证出现   | Pigeonhole Principle             |
| no one gets their own item     | 所有对象错位      | Derangements                     |
| handshakes / pairwise meetings | 两两配对        | $\binom n2$                  |

## 4. 概率（Probability）

| 题目条件 / English Keywords   | 判断方法       | 使用公式                         |
| ------------------------- | ---------- | ---------------------------- |
| probability of            | 等可能结果      | 有利结果数 / 总结果数                 |
| at least one success      | 至少成功一次     | $1-P(\text{no success})$ |
| either A or B             | A 或 B 发生   | Addition Rule                |
| both A and B              | 两件事都发生     | Multiplication Rule          |
| independent               | 事件互不影响     | $P(A)P(B)$               |
| given that                | 已知某事件发生    | Conditional Probability      |
| without replacement       | 不放回抽样      | 条件概率 / Hypergeometric        |
| exactly k successes       | 固定次数独立重复试验 | Binomial Probability         |
| expected value            | 长期平均结果     | $\sum x_iP_i$            |
| random point in a region  | 区域均匀随机取点   | 面积比                          |
| random point on a segment | 线段均匀随机取点   | 长度比                          |

## 5. 几何（Geometry）

| 题目条件 / English Keywords        | 判断方法       | 使用公式                                  |
| ------------------------------ | ---------- | ------------------------------------- |
| right triangle                 | 直角三角形      | Pythagorean Theorem                   |
| 30°, 60°, 90°                  | 特殊直角三角形    | $1:\sqrt3:2$                      |
| 45°, 45°, 90°                  | 等腰直角三角形    | $1:1:\sqrt2$                      |
| three sides given, find area   | 已知三边求面积    | Heron's Formula                       |
| similar triangles              | 对应角相等、边成比例 | Side Ratios / Area Ratios             |
| angle bisector                 | 角平分线分对边    | Angle Bisector Theorem                |
| median                         | 顶点连对边中点    | Median Area Property                  |
| centroid                       | 三条中线交点     | $2:1$                             |
| inradius / incircle            | 三角形内切圆     | $S=rs$                            |
| circumradius / circumcircle    | 三角形外接圆     | $S=abc/(4R)$                      |
| altitude to hypotenuse         | 斜边上的高      | $h^2=mn$                          |
| regular polygon interior angle | 正多边形内角     | $\frac{(n-2)180^\circ}{n}$        |
| number of diagonals            | 多边形对角线数量   | $n(n-3)/2$                        |
| arc length                     | 圆弧长度       | $\frac{\theta}{360^\circ}2\pi r$  |
| sector area                    | 扇形面积       | $\frac{\theta}{360^\circ}\pi r^2$ |
| inscribed angle                | 同弧圆周角      | 圆心角的一半                                |
| angle subtended by diameter    | 直径所对圆周角    | $90^\circ$                        |
| cyclic quadrilateral           | 圆内接四边形     | 对角互补                                  |
| tangent to a circle            | 切线与半径      | 垂直关系                                  |
| two tangents from a point      | 同一个外点的切线   | 切线长度相等                                |
| intersecting chords            | 圆内两条弦相交    | $PA\cdot PB=PC\cdot PD$           |
| secant and tangent             | 圆外割线、切线    | Power of a Point                      |
| distance from center to chord  | 圆心到弦的距离    | $L=2\sqrt{r^2-d^2}$               |
| lattice polygon                | 整数格点多边形    | Pick's Theorem                        |

## 6. 坐标及立体几何（Coordinate & Solid Geometry）

| 题目条件        | 使用公式                       |
| ----------- | -------------------------- |
| 两点之间距离      | Distance Formula           |
| 两点中点        | Midpoint Formula           |
| 直线斜率        | Slope Formula              |
| 经过一点且已知斜率   | Point–Slope Form           |
| 已知三个顶点求面积   | Coordinate Triangle Area   |
| 多边形顶点坐标求面积  | Shoelace Formula           |
| 坐标旋转或反射     | Coordinate Transformations |
| 正方体或长方体对角线  | 3D Pythagorean Theorem     |
| 圆柱体积        | $\pi r^2h$             |
| 圆锥体积        | $\frac13\pi r^2h$      |
| 球体积         | $\frac43\pi r^3$       |
| 球表面积        | $4\pi r^2$             |
| 相似立体面积比     | 长度比平方                      |
| 相似立体体积比     | 长度比立方                      |
| 多面体顶点、棱、面数量 | Euler's Polyhedron Formula |

# 第三部分：公式速查表

这一部分只保留公式、英文名称和必要条件。

## 1. 算术（Arithmetic）

| 英文名称                      | 公式                                                      |
| ---------------------------- | ------------------------------------------------------- |
| Percentage Change            | $N=O(1+r)$                                          |
| Percentage Rate              | $r=\frac{N-O}{O}$                                   |
| Arithmetic Mean              | $\bar x=\frac{\sum x_i}{n}$                         |
| Weighted Average             | $\bar x=\frac{\sum w_ix_i}{\sum w_i}$               |
| Distance                     | $d=vt$                                              |
| Average Speed                | $v=\frac{\text{Total distance}}{\text{Total time}}$ |
| Equal-distance Average Speed | $v=\frac{2ab}{a+b}$                                 |
| Work Rate                    | $W=rt$                                              |
| Combined Work                | $\frac1T=\frac1a+\frac1b$                           |
| Concentration                | $c=\frac{\text{Solute}}{\text{Solution}}$           |
| Compound Growth              | $A=P(1+r)^n$                                        |

## 2. 代数（Algebra）

| 英文名称               | 公式                                               |
| --------------------- | ------------------------------------------------ |
| Product of Powers     | $a^ma^n=a^{m+n}$                             |
| Quotient of Powers    | $a^m/a^n=a^{m-n}$                            |
| Power of a Power      | $(a^m)^n=a^{mn}$                             |
| Negative Exponent     | $a^{-n}=1/a^n$                               |
| Perfect Square        | $(a\pm b)^2=a^2\pm2ab+b^2$                   |
| Difference of Squares | $a^2-b^2=(a-b)(a+b)$                         |
| Sum of Cubes          | $a^3+b^3=(a+b)(a^2-ab+b^2)$                  |
| Difference of Cubes   | $a^3-b^3=(a-b)(a^2+ab+b^2)$                  |
| Quadratic Formula     | $x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$           |
| Discriminant          | $\Delta=b^2-4ac$                             |
| Vieta: Sum            | $r_1+r_2=-b/a$                               |
| Vieta: Product        | $r_1r_2=c/a$                                 |
| Quadratic Vertex      | $x=-b/(2a)$                                  |
| Quadratic Extremum    | $y=c-b^2/(4a)$                               |
| AM–GM                 | $\frac{a+b}{2}\ge\sqrt{ab}$, $a,b\ge0$   |
| Cauchy–Schwarz        | $(\sum a_i^2)(\sum b_i^2)\ge(\sum a_ib_i)^2$ |
| Logarithm Definition  | $a^x=b\iff x=\log_a b$                       |
| Log Product           | $\log_a(xy)=\log_a x+\log_a y$               |
| Log Quotient          | $\log_a(x/y)=\log_a x-\log_a y$              |
| Log Power             | $\log_a(x^r)=r\log_a x$                      |
| Change of Base        | $\log_a b=\frac{\log_c b}{\log_c a}$         |

适用条件：分母非零；对数底数为正且不为 1，真数为正；开方和不等式满足对应实数定义条件。

## 3. 数列与求和（Sequences & Series）

| 英文名称                | 公式                                                    |
| ---------------------- | ----------------------------------------------------- |
| Arithmetic nth Term    | $a_n=a_1+(n-1)d$                                  |
| Arithmetic Sum         | $S_n=\frac n2[2a_1+(n-1)d]$                       |
| Geometric nth Term     | $a_n=a_1r^{n-1}$                                  |
| Geometric Sum          | $S_n=a_1\frac{1-r^n}{1-r}$, $r\ne1$           |
| Infinite Geometric Sum | $S_\infty=\frac{a_1}{1-r}$, $\lvert r \rvert<1$        |
| Sum of Integers        | $\sum_{k=1}^n k=\frac{n(n+1)}2$                  |
| Sum of Squares         | $\sum_{k=1}^n k^2=\frac{n(n+1)(2n+1)}6$          |
| Sum of Cubes           | $\sum_{k=1}^n k^3=\left[\frac{n(n+1)}2\right]^2$ |
| Sum of Odd Numbers     | $\sum_{k=1}^n(2k-1)=n^2$                         |
| Sum of Even Numbers    | $\sum_{k=1}^n2k=n(n+1)$                          |
| Telescoping Identity   | $\frac1{k(k+1)}=\frac1k-\frac1{k+1}$              |
| Binomial Theorem       | $(a+b)^n=\sum_{r=0}^n\binom nr a^{n-r}b^r$       |
| Binomial Coefficient   | $\binom nr=\frac{n!}{r!(n-r)!}$                   |
| Pascal's Identity      | $\binom nr+\binom n{r-1}=\binom{n+1}r$            |
| Sum of Combinations    | $\sum_{r=0}^n\binom nr=2^n$                      |

## 4. 数论（Number Theory）

| 英文名称                    | 公式                                                     |
| -------------------------- | ------------------------------------------------------ |
| Prime Factorisation        | $N=\prod p_i^{a_i}$                                |
| Number of Divisors         | $d(N)=\prod(a_i+1)$                                |
| Sum of Divisors            | $\sigma(N)=\prod\frac{p_i^{a_i+1}-1}{p_i-1}$       |
| Product of Divisors        | $P(N)=N^{d(N)/2}$                                  |
| Square Divisor Count       | $\prod(\lfloor a_i/2\rfloor+1)$                    |
| GCD–LCM Identity           | $\gcd(a,b)\operatorname{lcm}(a,b)=ab$, $a,b>0$ |
| Euclidean Algorithm        | $\gcd(a,b)=\gcd(b,a\bmod b)$                       |
| Coprime                    | $\gcd(a,b)=1$                                      |
| Euler's Totient            | $\varphi(N)=N\prod_{p\mid N}(1-\frac1p)$          |
| Prime Totient              | $\varphi(p)=p-1$                                   |
| Prime Power Totient        | $\varphi(p^a)=p^a-p^{a-1}$                         |
| Congruence                 | $a\equiv b\pmod m\iff m\mid(a-b)$                  |
| Division Algorithm         | $N=dq+r,\quad0\le r<d$                            |
| Fermat's Little Theorem    | $a^{p-1}\equiv1\pmod p$, $p\nmid a$            |
| Euler's Theorem            | $a^{\varphi(m)}\equiv1\pmod m$, $\gcd(a,m)=1$  |
| Legendre's Formula         | $v_p(n!)=\sum_{j\ge1}\lfloor n/p^j\rfloor$        |
| Trailing Zeros of $n!$ | $\sum_{j\ge1}\lfloor n/5^j\rfloor$                |
| Perfect Square             | $N=\prod p_i^{a_i},\quad 2\mid a_i\ \forall i$     |
| Perfect Cube               | $N=\prod p_i^{a_i},\quad 3\mid a_i\ \forall i$     |
| Square Residues Modulo 4   | $n^2\equiv0,1\pmod4$                               |
| Base-$b$ Expansion     | $N=\sum_{i=0}^n a_ib^i$                           |
| Digit Sum                  | $N\equiv\sum \text{digits}\pmod9$                  |
| Integer Equation Criterion | $\gcd(a,b)\mid c$ for $ax+by=c$                |
| Multiples from 1 to N      | $\lfloor N/k\rfloor$                               |
| Multiples from A to B      | $\lfloor B/k\rfloor-\lfloor(A-1)/k\rfloor$         |

## 5. 组合计数（Combinatorics）

| 英文名称                        | 公式                                                     |
| ------------------------------ | ------------------------------------------------------ |
| Addition Principle             | $N=N_1+\cdots+N_k$                                 |
| Multiplication Principle       | $N=N_1\cdots N_k$                                  |
| Ordered with Repetition        | $n^r$                                              |
| Permutations                   | $P(n,r)=\frac{n!}{(n-r)!}$                         |
| Combinations                   | $\binom nr=\frac{n!}{r!(n-r)!}$                    |
| Unordered with Repetition      | $\binom{n+r-1}{r}$                                 |
| Identical Object Permutations  | $\frac{n!}{a_1!\cdots a_k!}$                       |
| Circular Permutations          | $(n-1)!$                                           |
| Circular with Reflection       | $(n-1)!/2$, $n\ge3$，对象互不相同                     |
| Nonnegative Integer Solutions  | $\binom{n+k-1}{k-1}$                               |
| Positive Integer Solutions     | $\binom{n-1}{k-1}$                                 |
| Two-set Inclusion–Exclusion    | $\lvert A\cup B \rvert=\lvert A \rvert+\lvert B \rvert-\lvert A\cap B \rvert$              |
| Complement Counting            | $N_{\rm wanted}=N_{\rm total}-N_{\rm unwanted}$ |
| Block Method                   | $(n-k+1)!k!$                                       |
| Lattice Paths                  | $\binom{m+n}{m}$                                   |
| Pigeonhole Principle           | $\lceil N/k\rceil$                                 |
| Minimum for $r$ in One Box | $k(r-1)+1$                                         |
| Derangements                   | $D_n=n!\sum_{k=0}^n(-1)^k/k!$                     |
| Derangement Recurrence         | $D_n=(n-1)(D_{n-1}+D_{n-2})$                     |
| Handshake Lemma                | $\sum\deg(v)=2E$                                   |
| Pairwise Connections           | $E=\binom n2$                                      |
| Maximum Line Intersections     | $\binom n2$                                        |
| Circle Chord Intersections     | $\binom n4$                                        |

计数公式必须满足对应的顺序、重复、对象是否可区分及其他限制条件。

## 6. 概率与统计（Probability & Statistics）

| 英文名称                    | 公式                                                       |
| -------------------------- | -------------------------------------------------------- |
| Classical Probability      | $P(A)=N(A)/N(S)$                                     |
| Complement                 | $P(A^c)=1-P(A)$                                      |
| Addition Rule              | $P(A\cup B)=P(A)+P(B)-P(A\cap B)$                    |
| Multiplication Rule        | $P(A\cap B)=P(A)P(B\mid A)$                          |
| Independent Events         | $P(A\cap B)=P(A)P(B)$                                |
| Conditional Probability    | $P(A\mid B)=P(A\cap B)/P(B)$                         |
| Binomial Probability       | $P(X=k)=\binom nk p^k(1-p)^{n-k}$                    |
| Hypergeometric Probability | $P(X=k)=\frac{\binom Kk\binom{N-K}{n-k}}{\binom Nn}$ |
| Expected Value             | $E(X)=\sum x_iP(X=x_i)$                              |
| Linearity of Expectation   | $E(X+Y)=E(X)+E(Y)$                                   |
| Geometric Probability      | $P=\text{Favourable measure}/\text{Total measure}$   |
| Range                      | $R=x_{\max}-x_{\min}$                              |

## 7. 三角形几何（Triangle Geometry）

| 英文名称                     | 公式                               |
| --------------------------- | -------------------------------- |
| Angle Sum                   | $A+B+C=180^\circ$            |
| Exterior Angle              | $\theta_{\rm ext}=A+B$      |
| Triangle Inequality         | $\lvert a-b \rvert<c<a+b$            |
| Pythagorean Theorem         | $a^2+b^2=c^2$                |
| 45°–45°–90°                 | $1:1:\sqrt2$                 |
| 30°–60°–90°                 | $1:\sqrt3:2$                 |
| Triangle Area               | $S=\frac12bh$                |
| Equilateral Height          | $h=\frac{\sqrt3}{2}a$        |
| Equilateral Area            | $S=\frac{\sqrt3}{4}a^2$      |
| Heron's Formula             | $S=\sqrt{s(s-a)(s-b)(s-c)}$  |
| Semiperimeter               | $s=\frac{a+b+c}{2}$          |
| Similar Triangle Area Ratio | $S_1/S_2=k^2$                |
| Angle Bisector Theorem      | $BD/DC=AB/AC$                |
| Centroid Ratio              | $AG/GD=2$                    |
| Inradius                    | $r=S/s$                      |
| Circumradius                | $R=abc/(4S)$                 |
| Right Triangle Circumradius | $R=c/2$                      |
| Altitude to Hypotenuse      | $h^2=mn$                     |
| Leg Projection              | $a^2=cm,\quad b^2=cn$        |
| Sine Rule                   | $a/\sin A=b/\sin B=c/\sin C$ |
| Cosine Rule                 | $a^2=b^2+c^2-2bc\cos A$      |
| Sine Area                   | $S=\frac12bc\sin A$          |

## 8. 多边形与圆（Polygons & Circles）

| 英文名称                        | 公式                                                    |
| ------------------------------ | ----------------------------------------------------- |
| Rectangle Area                 | $S=lw$                                            |
| Square Area                    | $S=a^2$                                           |
| Square Diagonal                | $d=a\sqrt2$                                       |
| Parallelogram Area             | $S=bh$                                            |
| Trapezoid Area                 | $S=\frac12(a+b)h$                                 |
| Rhombus Area                   | $S=\frac12d_1d_2$                                 |
| Polygon Interior Angle Sum     | $(n-2)180^\circ$                                  |
| Regular Polygon Interior Angle | $\frac{(n-2)180^\circ}{n}$                        |
| Regular Polygon Exterior Angle | $360^\circ/n$                                     |
| Polygon Diagonals              | $n(n-3)/2$                                        |
| Regular Polygon Area           | $S=\frac12Pa$                                     |
| Regular Hexagon Area           | $S=\frac{3\sqrt3}{2}a^2$                          |
| Circumference                  | $C=2\pi r$                                        |
| Circle Area                    | $S=\pi r^2$                                       |
| Arc Length                     | $L=\frac{\theta}{360^\circ}2\pi r$                |
| Sector Area                    | $S=\frac{\theta}{360^\circ}\pi r^2$               |
| Annulus Area                   | $S=\pi(R^2-r^2)$                                  |
| Inscribed Angle                | $\theta_{\rm inscribed}=\theta_{\rm central}/2$ |
| Cyclic Quadrilateral           | $A+C=B+D=180^\circ$                               |
| Equal Tangents                 | $PA=PB$                                           |
| Chord Length                   | $L=2\sqrt{r^2-d^2}$                               |
| Intersecting Chords            | $PA\cdot PB=PC\cdot PD$                           |
| Tangent–Secant                 | $PT^2=PA\cdot PB$                                 |
| Interior Chord Angle           | $\theta=(\alpha+\beta)/2$                         |
| Exterior Secant Angle          | $\theta=(\alpha-\beta)/2$                         |

## 9. 坐标几何（Coordinate Geometry）

| 英文名称                  | 公式                                                      |
| ------------------------ | ------------------------------------------------------- |
| Distance                 | $d=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}$                  |
| Midpoint                 | $M=(\frac{x_1+x_2}2,\frac{y_1+y_2}2)$               |
| Slope                    | $m=\frac{y_2-y_1}{x_2-x_1}$                         |
| Slope–Intercept          | $y=mx+c$                                            |
| Point–Slope              | $y-y_1=m(x-x_1)$                                    |
| Parallel Lines           | $m_1=m_2$                                           |
| Perpendicular Lines      | $m_1m_2=-1$                                         |
| Coordinate Triangle Area | $\frac12\lvert x_1(y_2-y_3)+x_2(y_3-y_1)+x_3(y_1-y_2) \rvert$ |
| Shoelace Formula         | $\frac12\lvert \sum x_iy_{i+1}-\sum y_ix_{i+1} \rvert$      |
| Pick's Theorem           | $S=I+B/2-1$                                         |
| Rotation 90° CCW         | $(x,y)\to(-y,x)$                                    |
| Rotation 90° CW          | $(x,y)\to(y,-x)$                                    |
| Rotation 180°            | $(x,y)\to(-x,-y)$                                   |
| Reflection in x-axis     | $(x,y)\to(x,-y)$                                    |
| Reflection in y-axis     | $(x,y)\to(-x,y)$                                    |

斜率平行与垂直公式要求相关斜率存在；竖直线须单独判断。

## 10. 立体几何（Solid Geometry）

| 英文名称                        | 公式                            |
| ------------------------------ | ----------------------------- |
| Cube Volume                    | $V=a^3$                   |
| Cube Surface Area              | $S=6a^2$                  |
| Cube Space Diagonal            | $d=a\sqrt3$               |
| Rectangular Prism Volume       | $V=lwh$                   |
| Rectangular Prism Surface Area | $S=2(lw+lh+wh)$           |
| Rectangular Prism Diagonal     | $d=\sqrt{l^2+w^2+h^2}$    |
| Prism Volume                   | $V=S_{\rm base}h$        |
| Pyramid Volume                 | $V=\frac13S_{\rm base}h$ |
| Cylinder Volume                | $V=\pi r^2h$              |
| Cylinder Total Surface Area    | $S=2\pi r^2+2\pi rh$      |
| Cone Volume                    | $V=\frac13\pi r^2h$       |
| Right Cone Slant Height        | $l=\sqrt{r^2+h^2}$        |
| Cone Lateral Area              | $S=\pi rl$                |
| Sphere Volume                  | $V=\frac43\pi r^3$        |
| Sphere Surface Area            | $S=4\pi r^2$              |
| Similar Solid Surface Ratio    | $S_1/S_2=k^2$             |
| Similar Solid Volume Ratio     | $V_1/V_2=k^3$             |
| Euler's Polyhedron Formula     | $V-E+F=2$                 |

## 11. 其他公式（Additional Formulae）

| 英文名称                     | 公式                                                                    |
| --------------------------- | --------------------------------------------------------------------- |
| Even Integer                | $2k$                                                              |
| Odd Integer                 | $2k+1$                                                            |
| Consecutive Integers        | $n,n+1,\ldots,n+k-1$                                              |
| Sum of Consecutive Integers | $\frac{k(2n+k-1)}2$                                               |
| Symmetric Square Sum        | $a^2+b^2=(a+b)^2-2ab$                                             |
| Symmetric Cube Sum          | $a^3+b^3=(a+b)^3-3ab(a+b)$                                        |
| Difference of Roots Squared | $(a-b)^2=(a+b)^2-4ab$                                             |
| Invariant Modulo m          | $N_{\rm new}\equiv N_{\rm old}\pmod m$                          |
| Clock Hour Hand             | $\theta_h=30h+0.5m$                                               |
| Clock Minute Hand           | $\theta_m=6m$                                                     |
| Clock Smallest Angle        | $\theta=\min(\Delta,360^\circ-\Delta)$, $\Delta=\lvert 30h-5.5m \rvert$ |
| Double Counting             | $\text{Count A}=\text{Count B}$                                   |

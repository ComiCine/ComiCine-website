---
title: AMC 10 完全公式ガイド
description: AMC 10で使う算術、代数、数論、組合せ、確率、幾何の公式、問題形式の見分け方、公式早見表。
---

# AMC 10 完全公式ガイド

# 第1部：公式の解説

## A. 数学記号（Mathematical Notation）

| 記号                            | English                  | 意味と計算方法                           |
| ----------------------------- | ------------------------ | --------------------------------- |
| $\sum$                    | Summation                | 指定された範囲の値を順に代入して足し合わせる                      |
| $\prod$                   | Product                  | 指定された範囲の値を順に代入して掛け合わせる                      |
| $n!$                      | Factorial                | 1から $n$ までを掛ける。$0!=1$ と定める      |
| $\binom nr$               | Combination              | $n$ 個の異なる対象から $r$ 個を選ぶ。順序は問わない |
| $\lfloor x\rfloor$        | Floor Function           | $x$ 以下の最大の整数                 |
| $\lceil x\rceil$          | Ceiling Function         | $x$ 以上の最小の整数                 |
| $a\mid b$                 | Divisibility             | $b$ が $a$ の整数倍である            |
| $a\equiv b\pmod m$        | Congruence               | $a-b$ が $m$ の整数倍である          |
| $\gcd(a,b)$               | Greatest Common Divisor  | 最大公約数                             |
| $\operatorname{lcm}(a,b)$ | Least Common Multiple    | 最小公倍数                             |
| $\varphi(n)$              | Euler's Totient Function | 1から $n$ までの整数のうち、$n$ と互いに素な正整数の個数   |
| $\lvert x\rvert$          | Absolute Value           | $x$ から 0 までの距離                   |
| $A\cap B$                 | Intersection             | AとBの両方に属する                        |
| $A\cup B$                 | Union                    | AまたはBに属する。両方に属してもよい                   |
| $A^c$                     | Complement               | Aに属さない                             |
| $\mathbb Z$               | Integers                 | 整数全体                              |
| $\mathbb R$               | Real Numbers             | 実数全体                              |
| $\forall$                 | For All                  | すべての……について                             |
| $\exists$                 | There Exists             | 少なくとも一つ……が存在する                            |
| $\iff$                    | If and Only If           | そのとき、かつそのときに限る                              |

### A1. 総和（Summation）

$$ \boxed{\sum_{k=a}^{b}f(k)} $$

計算方法： $k$ を $a$ から始めて1ずつ増やし、$b$ までのすべての $f(k)$ の値を足します。

各記号の意味：

- $k$：各項を計算するための変数。
- $a$：開始値。
- $b$：終了値。
- $f(k)$：各項の計算規則。

### A2. 総乗（Product）

$$ \boxed{\prod_{k=a}^{b}f(k)} $$

計算方法： $k$ を $a$ から $b$ まで動かしてそれぞれ $f(k)$ を計算し、得られた値をすべて掛け合わせます。

$\sum$ との違いは、$\sum$ は足し算、$\prod$ は掛け算を表すことです。

### A3. 階乗（Factorial）

$$ \boxed{n!=n(n-1)(n-2)\cdots2\cdot1} $$

ここで $n$ は非負整数であり、$0!=1$ とします。

計算方法： $n$ から1ずつ減らしながら、すべての正整数を掛け合わせます。

## B. 算術（Arithmetic）

### B1. 分数（Fractions）

加減：

$$ \boxed{\frac ab\pm\frac cd=\frac{ad\pm bc}{bd}} $$

乗法：

$$ \boxed{\frac ab\cdot\frac cd=\frac{ac}{bd}} $$

除法：

$$ \boxed{\frac ab\div\frac cd=\frac{ad}{bc}} $$

計算方法：

- 加減法：通分してから分子を足す、または引きます。
- 乗法：分子どうし、分母どうしを掛けます。
- 除法：割る数の分子と分母を入れ替えてから掛けます。
- 最後に約分します。

すべての分母は0以外でなければならず、除数も0であってはなりません。

### B2. 比（Ratios）

$$ a:b=m:n $$

ならば：

$$ \boxed{a=km,\qquad b=kn} $$

合計 $S=a+b$ が分かっている場合：

$$ \boxed{a=\frac{m}{m+n}S} $$

$$ \boxed{b=\frac{n}{m+n}S} $$

計算方法： 比の数を足して全体の比の単位数を求め、各部分の比が占める割合に応じて全体量を配分します。

### B3. 正比例と反比例（Direct & Inverse Proportion）

正比例：

$$ \boxed{y=kx} $$

反比例：

$$ \boxed{xy=k} $$

ここで $k$ は比例定数です。

計算方法：

- 正比例：$x,y$ の組が一つ分かっている場合、$k=y/x$ を計算します。
- 反比例：$x,y$ の組が一つ分かっている場合、$k=xy$ を計算します。
- 同じ $k$ を使って、ほかの値を求めます。

### B4. 百分率の変化（Percentage Change）

$$ \boxed{N=O(1+r)} $$

各記号の意味：

- $O$：Original Value（元の値）。
- $N$：New Value（新しい値）。
- $r$：正負の符号を含む変化率。小数で表します。

計算方法：

- $r$ だけ増加：元の値に $1+r$ を掛けます。
- $r$ だけ減少：元の値に $1-r$ を掛けます。この場合、$r$ は正の減少率です。

変化率を逆算する場合：

$$ \boxed{r=\frac{N-O}{O}} $$

複数回連続して変化する場合：

$$ \boxed{N=O(1+r_1)(1+r_2)\cdots(1+r_k)} $$

各回の変化率は、変化直前の値を基準にします。

### B5. 算術平均（Arithmetic Mean）

$$ \boxed{\bar x=\frac{x_1+x_2+\cdots+x_n}{n}} $$

計算方法： すべてのデータを足し、データ数で割ります。

合計を逆算する場合：

$$ \boxed{\text{Sum}=n\bar x} $$

### B6. 加重平均（Weighted Average）

$$ \boxed{ \bar x=\frac{w_1x_1+w_2x_2+\cdots+w_nx_n} {w_1+w_2+\cdots+w_n} } $$

ここで $w_i$ は対応するデータの重みです。

計算方法： 各値に対応する重みを掛けてから合計し、最後に重みの合計で割ります。

### B7. 速さ・距離・時間（Speed, Distance & Time）

$$ \boxed{d=vt} $$

$$ \boxed{v=\frac dt} \qquad \boxed{t=\frac dv} $$

各記号の意味：

- $d$：Distance（距離）。
- $v$：Speed（速さ）。
- $t$：Time（時間）。

計算方法： 既知の二つの量から残りの量を求めます。単位をそろえてください。

平均速度：

$$ \boxed{v_{\mathrm{avg}}=\frac{\text{Total Distance}}{\text{Total Time}}} $$

同じ距離を往復し、往路と復路の速さがそれぞれ $v_1,v_2$ の場合：

$$ \boxed{v_{\mathrm{avg}}=\frac{2v_1v_2}{v_1+v_2}} $$

向かい合って進む場合、接近する速さは $v_1+v_2$ です。同じ方向に進んで追いつく場合、追いかける側の速さが大きいことを前提として、追いつく速さは二者の速さの差です。

### B8. 仕事率（Work & Rate）

$$ \boxed{W=rt} $$

各記号の意味：

- $W$：完了した仕事量。
- $r$：単位時間あたりの仕事量。
- $t$：作業時間。

AとBが同じ仕事を一人で完了するのにそれぞれ $a,b$ 時間かかり、互いに独立して同時に作業できる場合：

$$ \boxed{\frac1T=\frac1a+\frac1b} $$

$$ \boxed{T=\frac{ab}{a+b}} $$

計算方法： 各人の仕事率を足し、全体の仕事量を合計の仕事率で割ります。

### B9. 混合物と濃度（Mixtures & Concentrations）

$$ \boxed{c=\frac{m_{\mathrm{solute}}}{m_{\mathrm{solution}}}} $$

各記号の意味：

- $c$：濃度または質量分率。
- $m_{\mathrm{solute}}$：溶質の質量。
- $m_{\mathrm{solution}}$：溶液の質量。

溶質が失われない状態で混合する場合：

$$ \boxed{ c_{\mathrm{new}}= \frac{m_1c_1+m_2c_2}{m_1+m_2} } $$

計算方法： 各部分に含まれる溶質の質量をそれぞれ求めて足し、混合物全体の質量で割ります。

### B10. 複利成長（Compound Growth）

$$ \boxed{A=P(1+r)^n} $$

各記号の意味：

- $P$：初期量。
- $A$：最終量。
- $r$：各期間の成長率。
- $n$：期間数。

計算方法： 各期間に同じ成長係数を掛ける操作を $n$ 回繰り返します。

各期間に $r>0$ の割合で減少する場合：

$$ \boxed{A=P(1-r)^n} $$

## C. 代数（Algebra）

### C1. 指数法則（Exponent Laws）

$$ \boxed{a^ma^n=a^{m+n}} $$

$$ \boxed{\frac{a^m}{a^n}=a^{m-n}} $$

$$ \boxed{(a^m)^n=a^{mn}} $$

$$ \boxed{(ab)^n=a^nb^n} $$

$$ \boxed{a^{-n}=\frac1{a^n}} $$

$$ \boxed{a^{1/n}=\sqrt[n]{a}} $$

計算方法：

- 同じ底の積：指数を足します。
- 同じ底の商：指数を引きます。
- べき乗のべき乗：指数どうしを掛けます。
- 負の指数：逆数にします。
- 分数指数：分母は根号の次数、分子はべき乗の指数を表します。

除法を含む場合、該当する底は0以外でなければなりません。偶数乗根を含む場合は、実数の範囲で定義される条件を満たす必要があります。

### C2. 代数恒等式（Algebraic Identities）

$$ \boxed{(a+b)^2=a^2+2ab+b^2} $$

$$ \boxed{(a-b)^2=a^2-2ab+b^2} $$

$$ \boxed{a^2-b^2=(a-b)(a+b)} $$

$$ \boxed{a^3+b^3=(a+b)(a^2-ab+b^2)} $$

$$ \boxed{a^3-b^3=(a-b)(a^2+ab+b^2)} $$

$$ \boxed{(a+b)^3=a^3+3a^2b+3ab^2+b^3} $$

$$ \boxed{(a-b)^3=a^3-3a^2b+3ab^2-b^3} $$

計算方法： 式が平方、立方、平方差の形に当てはまるかを見て、展開するか、逆に因数分解するかを選びます。

### C3. 二次方程式の解の公式（Quadratic Formula）

次の方程式に対して：

$$ ax^2+bx+c=0,\qquad a\ne0 $$

解は：

$$ \boxed{x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}} $$

判別式：

$$ \boxed{\Delta=b^2-4ac} $$

計算方法： $a,b,c$ を確認し、$\Delta$ を計算してから解の公式に代入します。

- $\Delta>0$：異なる二つの実数解。
- $\Delta=0$：重解となる実数解が一つ。
- $\Delta<0$：実数解はありません。

### C4. ヴィエタの公式（Vieta's Formulas）

$r_1,r_2$ が二次方程式 $ax^2+bx+c=0$ の二つの解なら：

$$ \boxed{r_1+r_2=-\frac ba} $$

$$ \boxed{r_1r_2=\frac ca} $$

計算方法： 解を先に求めなくても、係数から解の和と積を直接求められます。

さらに：

$$ \boxed{r_1^2+r_2^2=(r_1+r_2)^2-2r_1r_2} $$

$$ \boxed{(r_1-r_2)^2=(r_1+r_2)^2-4r_1r_2} $$

既知の解の和と積をこれらの恒等式に代入します。

### C5. 平方完成（Completing the Square）

$$ \boxed{ ax^2+bx+c= a\left(x+\frac{b}{2a}\right)^2+ c-\frac{b^2}{4a} } $$

ここで $a\ne0$ です。

計算方法：

1. 二次の係数 $a$ をくくり出します。
2. かっこ内の一次の係数を2で割ります。
3. 完全平方の形にします。
4. 残りの定数項を調整します。

$a>0$ の場合、関数の最小値は：

$$ \boxed{c-\frac{b^2}{4a}} $$

$a<0$ の場合、同じ値が最大値になります。

極値をとるのは：

$$ \boxed{x=-\frac b{2a}} $$

### C6. 絶対値（Absolute Value）

$$ \boxed{ |x|= \begin{cases} x,&x\ge0\\ -x,&x<0 \end{cases} } $$

絶対値方程式：

$$ |x-a|=d $$

$d\ge0$ の場合：

$$ \boxed{x=a\pm d} $$

計算方法： 絶対値を距離とみなし、その距離を満たす位置を左右それぞれ探します。

$d>0$ の場合：

$$ \boxed{|x-a|<d\iff a-d<x<a+d} $$

$$ \boxed{|x-a|>d\iff x<a-d\text{ 或 }x>a+d} $$

### C7. 根号（Radicals）

$$ \boxed{\sqrt{ab}=\sqrt a\sqrt b} \quad(a,b\ge0) $$

$$ \boxed{\sqrt{a^2}=|a|} $$

分母の有理化：

$$ \boxed{ \frac1{a+\sqrt b} =\frac{a-\sqrt b}{a^2-b} } $$

実数の範囲で $b\ge0$、かつ $a^2\ne b$ とします。これにより、元の式と有理化後の分母がどちらも 0 になりません。

計算方法： 分子と分母に分母の共役式を掛け、平方差を利用して分母の根号を消します。

### C8. 相加相乗平均不等式（Arithmetic–Geometric Mean Inequality）

非負の実数 $a,b$ に対して：

$$ \boxed{\frac{a+b}{2}\ge\sqrt{ab}} $$

同値な式：

$$ \boxed{(a+b)^2\ge4ab} $$

計算方法：

- 和が分かっていて積の最大値を求める：$ab\le(a+b)^2/4$ を使います。
- 正の積が分かっていて和の最小値を求める：$a+b\ge2\sqrt{ab}$ を使います。

等号が成り立つのは $a=b$ のとき、かつそのときに限ります。

非負の実数 $n$ 個に対して：

$$ \boxed{ \frac{x_1+\cdots+x_n}{n} \ge\sqrt[n]{x_1x_2\cdots x_n} } $$

### C9. コーシー・シュワルツの不等式（Cauchy–Schwarz Inequality）

$$ \boxed{ (a^2+b^2)(c^2+d^2)\ge(ac+bd)^2 } $$

一般形：

$$ \boxed{ \left(\sum_{i=1}^n a_i^2\right) \left(\sum_{i=1}^n b_i^2\right) \ge \left(\sum_{i=1}^n a_ib_i\right)^2 } $$

計算方法： 求めたい式を二つの平方和と対応する積の和に分け、不等式を使って上限や下限を求めます。

よく使う系：

$$ \boxed{a^2+b^2\ge\frac{(a+b)^2}{2}} $$

### C10. 等差数列（Arithmetic Sequences）

$$ \boxed{a_n=a_1+(n-1)d} $$

$$ \boxed{S_n=\frac n2(a_1+a_n)} $$

$$ \boxed{S_n=\frac n2[2a_1+(n-1)d]} $$

各記号の意味：

- $a_1$：初項。
- $a_n$：第 $n$ 項。
- $d$：公差。
- $S_n$：初項から第 $n$ 項までの和。

計算方法：

- 指定された項を求める：初項に公差を $n-1$ 個分加えます。
- 和を求める：項数に初項と末項の平均を掛けます。
- 項数を求める：和または指定された項を方程式に代入して $n$ を求め、正の整数であることを確認します。

### C11. 等比数列（Geometric Sequences）

$$ \boxed{a_n=a_1r^{n-1}} $$

$r\ne1$ の場合：

$$ \boxed{S_n=a_1\frac{1-r^n}{1-r}} $$

$|r|<1$ の場合：

$$ \boxed{S_\infty=\frac{a_1}{1-r}} $$

計算方法： 各項に一定の公比 $r$ を掛けます。求めるものに応じて、第 $n$ 項、有限項の和、無限項の和の公式を選びます。

$r=1$ の場合、有限項の和は $na_1$ です。

### C12. よく使う総和（Standard Sums）

最初の $n$ 個の正の整数：

$$ \boxed{\sum_{k=1}^n k=\frac{n(n+1)}2} $$

最初の $n$ 個の正の整数の平方：

$$ \boxed{\sum_{k=1}^n k^2=\frac{n(n+1)(2n+1)}6} $$

最初の $n$ 個の正の整数の立方：

$$ \boxed{\sum_{k=1}^n k^3=\left[\frac{n(n+1)}2\right]^2} $$

最初の $n$ 個の正の奇数：

$$ \boxed{\sum_{k=1}^n(2k-1)=n^2} $$

最初の $n$ 個の正の偶数：

$$ \boxed{\sum_{k=1}^n2k=n(n+1)} $$

計算方法： 和を取る対象が連続する整数、平方、立方、奇数、偶数のどれに当たるかを見分け、項数を代入します。

### C13. 望遠鏡和（Telescoping Sums）

$$ \boxed{\frac1{k(k+1)}=\frac1k-\frac1{k+1}} $$

したがって：

$$ \boxed{ \sum_{k=1}^n\frac1{k(k+1)} =1-\frac1{n+1} =\frac n{n+1} } $$

計算方法：

1. 各項を二つの分数の差に分解します。
2. 最初と最後の数項を展開します。
3. 正負が一致する隣接項を互いに打ち消します。
4. 相殺されずに残った最初と最後の項だけを計算します。

### C14. 二項定理（Binomial Theorem）

$$ \boxed{(a+b)^n=\sum_{r=0}^{n}\binom nr a^{n-r}b^r} $$

ここで：

$$ \boxed{\binom nr=\frac{n!}{r!(n-r)!}} $$

第 $r+1$ 項：

$$ \boxed{T_{r+1}=\binom nr a^{n-r}b^r} $$

計算方法：

1. 全体の指数 $n$ を確認します。
2. 求めるのが何番目の項か、またはどの次数の項かを確認します。
3. 対応する $r$ を特定します。
4. 二項係数と二つの因子のべき乗を計算します。
5. 負の符号がある場合は、その符号も対応する指数に含めます。

よく使う組合せの恒等式：

$$ \boxed{\binom nr=\binom n{n-r}} $$

$$ \boxed{\binom nr+\binom n{r-1}=\binom{n+1}r} $$

$$ \boxed{\sum_{r=0}^{n}\binom nr=2^n} $$

### C15. 対数（Logarithms）

$$ \boxed{a^x=b\iff x=\log_a b} $$

ここで $a>0$、$a\ne1$、$b>0$ です。

$$ \boxed{\log_a(xy)=\log_a x+\log_a y} $$

$$ \boxed{\log_a\frac xy=\log_a x-\log_a y} $$

$$ \boxed{\log_a(x^r)=r\log_a x} $$

底の変換公式：

$$ \boxed{\log_a b=\frac{\log_c b}{\log_c a}} $$

計算方法： 対数の問題を指数の問題として捉えるか、積・商・べき乗に関する対数の法則を使ってまとめたり分解したりします。すべての真数は正でなければなりません。

## D. 数論（Number Theory）

### D1. 整除（Divisibility）

$$ \boxed{a\mid b\iff b=ak,\quad k\in\mathbb Z,\quad a\ne0} $$

計算方法： $a\ne0$ とします。$b/a$ が整数かどうかを判定するか、$b$ を $a$ の整数倍として表せるかを確認します。

整除の性質：

$$ \boxed{ a\mid b,\ a\mid c \Longrightarrow a\mid(mb+nc) } $$

ここで $m,n$ は整数です。

つまり、$a$ が $b,c$ の両方を割り切るなら、それらの整数係数線形結合もすべて割り切ります。

### D2. 整除判定法（Divisibility Tests）

| 除数 | 判定方法                         |
| -- | ---------------------------- |
| 2  | 一の位が偶数か確認する                    |
| 3  | 各位の数字の和が3の倍数か確認する           |
| 4  | 下二桁でできる数を確認する                    |
| 5  | 一の位が0または5か確認する                |
| 6  | 2と3の両方の判定を満たす                 |
| 8  | 下三桁でできる数を確認する                    |
| 9  | 各位の数字の和が9の倍数か確認する              |
| 10 | 一の位が0か確認する                    |
| 11 | 端から各位の数字を交互に足し引きし、その結果が11の倍数か確認する |
| 12 | 3と4の両方の判定を満たす                 |
| 25 | 下二桁でできる数が25で割り切れるか確認する               |

### D3. 素数（Prime Numbers）

正整数 $p>1$ が素数であるのは、正の約数が1と $p$ だけであるとき、かつそのときに限ります。

計算方法： $N>1$ が素数かどうかを判定するには、次の不等式を確認します。

$$ \boxed{p\le\sqrt N} $$

その範囲の素数 $p$ が $N$ を割り切るか調べます。

どの素数でも割り切れなければ、$N$ は素数です。

### D4. 素因数分解（Prime Factorisation）

$N>1$ に対して：

$$ \boxed{N=p_1^{a_1}p_2^{a_2}\cdots p_k^{a_k}} $$

計算方法： 小さい素数から順に割り、同じ素因数を指数形式にまとめます。

ここで $p_i$ は互いに異なる素数、$a_i$ は正整数です。

### D5. 正の約数の個数（Number of Divisors）

$$ \boxed{d(N)=\prod_{i=1}^k(a_i+1)} $$

展開した形：

$$ \boxed{d(N)=(a_1+1)(a_2+1)\cdots(a_k+1)} $$

計算方法： 各素因数の指数に1を足し、すべて掛け合わせます。

$N=1$ の場合、約数の個数は1です。

### D6. 正の約数の和（Sum of Divisors）

$$ \boxed{ \sigma(N)= \prod_{i=1}^k \left(1+p_i+p_i^2+\cdots+p_i^{a_i}\right) } $$

同値な式：

$$ \boxed{ \sigma(N)= \prod_{i=1}^k \frac{p_i^{a_i+1}-1}{p_i-1} } $$

計算方法： 各素因数について、0乗から最大の指数までのべき乗をすべて足し、それぞれの和を掛け合わせます。

### D7. 正の約数の積（Product of Divisors）

$$ \boxed{P(N)=N^{d(N)/2}} $$

計算方法： まず正の約数の個数 $d(N)$ を求め、その半分を $N$ の指数にします。

$d(N)$ が奇数の場合も、この公式は成り立ちます。

### D8. 平方数である約数の個数（Square Divisors）

$$ \boxed{ d_{\mathrm{square}}(N)= \prod_{i=1}^k \left(\left\lfloor\frac{a_i}{2}\right\rfloor+1\right) } $$

計算方法： 各素因数について、指数が0から $a_i$ までの範囲に偶数がいくつあるか数え、それぞれの個数を掛け合わせます。

### D9. 完全べき（Perfect Powers）

正整数 $N$ が完全 $m$ 乗数であるのは、その素因数分解に現れるすべての指数が $m$ の倍数であるとき、かつそのときに限ります。

$$ \boxed{ N=x^m\iff m\mid a_i\text{ 对所有 }i } $$

計算方法： 素因数分解してから、各指数が $m$ で割り切れるか確認します。

### D10. 最大公約数と最小公倍数（GCD & LCM）

$$ \boxed{\gcd(a,b)\operatorname{lcm}(a,b)=ab} $$

ここで $a,b$ は正整数です。

$$ a=\prod p_i^{\alpha_i}, \qquad b=\prod p_i^{\beta_i} $$

式に現れない素因数の指数は0とみなすと：

$$ \boxed{\gcd(a,b)=\prod p_i^{\min(\alpha_i,\beta_i)}} $$

$$ \boxed{\operatorname{lcm}(a,b)=\prod p_i^{\max(\alpha_i,\beta_i)}} $$

計算方法：

- 最大公約数：各素因数について小さい方の指数を取ります。
- 最小公倍数：各素因数について大きい方の指数を取ります。

### D11. ユークリッドの互除法（Euclidean Algorithm）

$$ \boxed{\gcd(a,b)=\gcd(b,a\bmod b)} $$

計算方法： 余りが0になるまで、「割る数と余り」の組で元の二つの数を繰り返し置き換えます。最後の0以外の余りがGCDです。

### D12. 互いに素（Coprime）

$$ \boxed{\gcd(a,b)=1} $$

計算方法： 二つの数に1より大きい共通の素因数があるか確認します。

連続する整数について：

$$ \boxed{\gcd(n,n+1)=1} $$

### D13. オイラーのトーシェント関数（Euler's Totient Function）

$$ \boxed{ \varphi(N)=N\prod_{p\mid N}\left(1-\frac1p\right) } $$

各記号の意味：

- $N$：互いに素な数の個数を求める対象の正整数。
- $p\mid N$：$p$ は $N$ の素因数です。
- $\prod_{p\mid N}$：異なる素因数を一つずつ取り、対応する因子を掛け合わせます。

平易な計算式：

$$ \boxed{ \varphi(N)= N\times \frac{p_1-1}{p_1}\times \frac{p_2-1}{p_2}\times\cdots\times \frac{p_k-1}{p_k} } $$

計算方法： 素因数分解する → 異なる素因数を一つずつ取る → 対応する分数を計算する → $N$ に順に掛けます。

$p$ が素数の場合：

$$ \boxed{\varphi(p)=p-1} $$

$p$ が素数で $a\ge1$ の場合：

$$ \boxed{\varphi(p^a)=p^a-p^{a-1}} $$

また、次のように定めます。

$$ \boxed{\varphi(1)=1} $$

### D14. 合同式（Modular Arithmetic）

$$ \boxed{a\equiv b\pmod m} $$

これは次と同値です。

$$ \boxed{m\mid(a-b)} $$

ここで法 $m$ は正整数です。

計算方法： $a,b$ をそれぞれ $m$ で割った余りを求め、同じかどうかを判定します。

演算規則：

$$ \boxed{(a+b)\bmod m=((a\bmod m)+(b\bmod m))\bmod m} $$

$$ \boxed{(ab)\bmod m=((a\bmod m)(b\bmod m))\bmod m} $$

$$ \boxed{a^n\bmod m=((a\bmod m)^n)\bmod m} $$

最後の公式は非負整数の指数に適用できます。

注意： 合同式の計算で除法を無条件に使うことはできません。

### D15. 余りの表し方（Remainder Representation）

$$ \boxed{N=dq+r} $$

ここで：

$$ \boxed{0\le r<d} $$

$d$ は正の除数、$q$ は整数の商、$r$ は余りです。

計算方法： 「$d$ で割ると余りが $r$」という条件を $N=dq+r$ に置き換え、ほかの条件と合わせて整数 $q$ を求めます。

### D16. 一の位の周期（Units Digit Cycles）

$$ \boxed{\text{Last digit of }N=N\bmod10} $$

べき $a^n$ については、まず一の位の周期の長さ $L$ を求めます。

次に：

$$ \boxed{r=n\bmod L} $$

計算方法： 指数の余り $r$ から周期中の位置を特定します。$r=0$ の場合は周期の最後の項を取ります。

| 底の一の位 | 周期の並び    |
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

この表は正整数の指数に対して適用します。

下二桁を求める場合は法100、下三桁なら法1000を使い、周期を改めて確認します。

### D17. フェルマーの小定理（Fermat's Little Theorem）

$p$ が素数で、$p\nmid a$ の場合：

$$ \boxed{a^{p-1}\equiv1\pmod p} $$

計算方法： 大きな指数を $p-1$ 個ずつのまとまりに分け、各まとまりの値が $p$ を法として1になる性質を使って計算を簡単にします。

### D18. オイラーの定理（Euler's Theorem）

次の条件を満たす場合：

$$ \gcd(a,m)=1 $$

$$ \boxed{a^{\varphi(m)}\equiv1\pmod m} $$

計算方法： まず $\varphi(m)$ を計算し、指数の周期性を使ってべき乗の余りを簡単にします。

### D19. 階乗に含まれる素因数の指数（Factorial Prime Exponents）

$$ \boxed{ v_p(n!)= \sum_{j=1}^{\infty} \left\lfloor\frac n{p^j}\right\rfloor } $$

ここで $p$ は素数でなければなりません。

平易な計算式：

$$ \boxed{ \left\lfloor\frac np\right\rfloor+ \left\lfloor\frac n{p^2}\right\rfloor+ \left\lfloor\frac n{p^3}\right\rfloor+\cdots } $$

計算方法： $p,p^2,p^3,\ldots$ で順に割り、各商を切り捨てて足します。商が1未満になったら終了します。

### D20. 階乗の末尾の0（Trailing Zeros）

十進法では：

$$ \boxed{ Z(n!)= \left\lfloor\frac n5\right\rfloor+ \left\lfloor\frac n{25}\right\rfloor+ \left\lfloor\frac n{125}\right\rfloor+\cdots } $$

計算方法： $n!$ に含まれる因数5の指数の合計を計算します。因数2は常に十分な数だけあります。

### D21. 位取り記数法（Number Bases）

$$ \boxed{ (a_na_{n-1}\cdots a_0)_b =\sum_{i=0}^{n}a_i b^i } $$

各記号の意味：

- $b$：底となる進数。整数で $b\ge2$。
- $a_i$：各桁の数字。$0\le a_i<b$ を満たします。

計算方法： 右端の桁から、それぞれの数字に $b^0,b^1,b^2,\ldots$ を掛けて足します。

十進法から底 $b$ の記数法へ変換するには、$b$ で繰り返し割り、余りを記録して、最後に逆順に並べます。

### D22. 各位の数字の和（Digit Sum）

十進整数 $N$ の各位の数字の和を $S$ とすると：

$$ \boxed{N\equiv S\pmod9} $$

$$ \boxed{N\equiv S\pmod3} $$

計算方法： 各桁の数字を足し、その和を3または9で割った余りを調べます。

### D23. 数字の逆順（Reversed Digits）

三桁の数：

$$ \boxed{N=100a+10b+c} $$

逆順にした数：

$$ \boxed{R=100c+10b+a} $$

したがって：

$$ \boxed{N-R=99(a-c)} $$

計算方法： 各桁の数字に対応する位の値を掛けます。元の順序と逆順の式をそれぞれ書き、引き算します。

### D24. 一次不定方程式（Linear Diophantine Equations）

$a,b,c$ が整数で、$a,b$ が同時に0ではない場合：

$$ \boxed{ax+by=c} $$

整数解が存在するための必要十分条件：

$$ \boxed{\gcd(a,b)\mid c} $$

計算方法： まずGCDを求め、それが $c$ を割り切るか判定します。割り切る場合は、余り、代入、またはユークリッドの互除法を使って整数解を探します。

正整数解または非負整数解が必要な場合は、さらに範囲も確認します。

### D25. 倍数の個数（Counting Multiples）

$$ \boxed{ M(1,N;k)=\left\lfloor\frac Nk\right\rfloor } $$

$$ \boxed{ M(A,B;k)= \left\lfloor\frac Bk\right\rfloor- \left\lfloor\frac{A-1}{k}\right\rfloor } $$

ここで $A,B,k$ はすべて正整数で、$A\le B$ です。

計算方法： 区間の上限までにある倍数の個数から、区間の下限より前にある倍数の個数を引きます。

## E. 組合せ計数（Combinatorics）

### E1. 加法原理（Addition Principle）

$$ \boxed{N=N_1+N_2+\cdots+N_k} $$

計算方法： 重複しないすべての場合をそれぞれ数え、足し合わせます。

場合に重複がある場合は、包除原理で補正する必要があります。

### E2. 乗法原理（Multiplication Principle）

$$ \boxed{N=N_1N_2\cdots N_k} $$

計算方法： 手順を複数の段階に分け、各段階での選択数を数えて掛け合わせます。

段階ごとの選択数が正しく数えられている必要があります。各段階の選択数が前の選択に依存する場合は、さらに場合分けします。

### E3. 順列（Permutations）

$$ \boxed{P(n,r)=\frac{n!}{(n-r)!}} $$

計算方法： $n$ 個の異なる対象から $r$ 個を選びます。順序が重要で、重複は認めません。

直接計算する場合：

$$ \boxed{n(n-1)\cdots(n-r+1)} $$

因数は合計 $r$ 個です。

### E4. 組合せ（Combinations）

$$ \boxed{\binom nr=\frac{n!}{r!(n-r)!}} $$

計算方法： $n$ 個の異なる対象から $r$ 個を選びます。順序は問わず、重複は認めません。

まず順列の数を計算し、同じ組に含まれる要素の並べ替え $r!$ 通りで割ります。

### E5. 重複を許す選択（Selections with Repetition）

$n$ 種類の異なるものから $r$ 回選ぶ場合：

順序が重要な場合：

$$ \boxed{n^r} $$

順序が重要でない場合：

$$ \boxed{\binom{n+r-1}{r}} $$

計算方法：

- 順序が重要：各位置に $n$ 通りの選択肢があります。
- 順序が重要でない：仕切り法を使って、各種類から何個選ぶかを数えます。

### E6. 同じ対象を含む順列（Permutations of Identical Objects）

合計 $n$ 個の対象があり、各種類の同一対象がそれぞれ $a_1,a_2,\ldots,a_k$ 個ある場合：

$$ \boxed{ N=\frac{n!}{a_1!a_2!\cdots a_k!} } $$

条件：

$$ a_1+\cdots+a_k=n $$

計算方法： すべての対象が異なると仮定した順列数を求め、同一対象の各グループ内の並べ替えの数で割ります。

### E7. 円順列（Circular Permutations）

$n$ 個の異なる対象を円形に並べ、回転だけを同じとみなす場合：

$$ \boxed{(n-1)!} $$

回転と裏返しの両方を同じとみなし、$n\ge3$ の場合：

$$ \boxed{\frac{(n-1)!}{2}} $$

計算方法： 一つの対象を固定して回転による重複をなくします。裏返しも同じとみなす場合は、さらに2で割ります。

### E8. 仕切り法（Stars and Bars）

非負整数解を求める場合：

$$ x_1+x_2+\cdots+x_k=n,\qquad x_i\ge0 $$

$$ \boxed{N=\binom{n+k-1}{k-1}} $$

正整数解を求める場合：

$$ x_1+x_2+\cdots+x_k=n,\qquad x_i\ge1 $$

$$ \boxed{N=\binom{n-1}{k-1}} $$

計算方法：

- 0を許す場合：$n$ 個の同一物と $k-1$ 本の仕切りを並べます。
- 各変数が少なくとも1の場合：まず各グループに1個ずつ与え、その後、0を許す場合の公式を使います。

各変数に異なる下限 $L_i$ がある場合は、まず $y_i=x_i-L_i$ と置いてから、非負整数解の公式を使います。

### E9. 包除原理（Inclusion–Exclusion Principle）

二つの集合：

$$ \boxed{|A\cup B|=|A|+|B|-|A\cap B|} $$

三つの集合：

$$ \boxed{ \begin{aligned} |A\cup B\cup C| ={}&|A|+|B|+|C|\\ &-|A\cap B|-|A\cap C|-|B\cap C|\\ &+|A\cap B\cap C| \end{aligned} } $$

計算方法： 各集合の個数を足し、二集合の共通部分を引き、三集合の共通部分を足します。集合がさらに増える場合は、符号を交互にして足し引きします。

### E10. 補集合による計数（Complementary Counting）

$$ \boxed{N_{\mathrm{wanted}}=N_{\mathrm{total}}-N_{\mathrm{unwanted}}} $$

計算方法： まずすべての場合を数え、条件を満たさない場合を引きます。

### E11. ひとかたまりとして数える方法（Block Method）

指定された異なる $k$ 個の対象が隣り合い、異なる対象が合計 $n$ 個ある場合：

$$ \boxed{N=(n-k+1)!\,k!} $$

計算方法： 指定された $k$ 個を一つのまとまりとみなし、残る $n-k+1$ 個の単位を並べてから、まとまりの内部で並べる $k!$ 通りを掛けます。

この公式は、ほかに制限のない一列の順列に限って適用できます。

### E12. 格子経路（Lattice Paths）

右に $m$ 歩、上に $n$ 歩だけ進む場合：

$$ \boxed{N=\binom{m+n}{m}} $$

計算方法： 合計 $m+n$ 歩のうち、右に進む $m$ 歩の位置を選びます。残りは自動的に上向きになります。

点Pを必ず通る場合：

$$ \boxed{N=N_{\mathrm{start}\to P}N_{P\to\mathrm{end}}} $$

点Pを通ってはいけない場合：

$$ \boxed{N_{\mathrm{allowed}}=N_{\mathrm{total}}-N_{\mathrm{through}\ P}} $$

目標点と中間点が移動方向の条件を満たしていることが前提です。

### E13. 鳩の巣原理（Pigeonhole Principle）

$N$ 個の対象を $k$ 個の分類に分ける場合：

$$ \boxed{ \text{某类别至少包含 } \left\lceil\frac Nk\right\rceil \text{ 个对象} } $$

計算方法： 対象の総数を分類数で割り、切り上げます。

少なくとも一つの分類に $r$ 個の対象が入ることを保証する場合：

$$ \boxed{N_{\min}=k(r-1)+1} $$

計算方法： まず各分類に最大 $r-1$ 個ずつ入れ、さらに対象を一つ追加します。

### E14. 漸化式（Recurrence Relations）

$$ \boxed{a_n=f(a_{n-1},a_{n-2},\ldots)} $$

計算方法： $n$ 規模の問題を、より小さな規模の問題に分解し、初期条件に従って順に計算します。

よく使われるフィボナッチ型の漸化式：

$$ \boxed{F_n=F_{n-1}+F_{n-2}} $$

ただし、初項は問題での定義に従って決める必要があります。

### E15. 完全順列（Derangements）

$n$ 個の異なる対象を並べ、どの対象も元の位置に戻らないようにする場合：

$$ \boxed{ D_n=n!\sum_{k=0}^{n}\frac{(-1)^k}{k!} } $$

展開形：

$$ \boxed{ D_n=n!\left(1-\frac1{1!}+\frac1{2!} -\frac1{3!}+\cdots+\frac{(-1)^n}{n!}\right) } $$

計算方法： まずすべての $n!$ 通りの並べ方を数え、包除原理を使って元の位置にある対象を含む並べ方を除外します。

漸化式：

$$ \boxed{D_n=(n-1)(D_{n-1}+D_{n-2})} $$

初期値：

$$ D_0=1,\qquad D_1=0 $$

### E16. 握手定理（Handshake Lemma）

無向グラフでは：

$$ \boxed{\sum_{v\in V}\deg(v)=2E} $$

各記号の意味：

- $\deg(v)$：頂点 $v$ の次数、つまりその頂点につながる辺の数。
- $E$：辺の総数。

計算方法： 各頂点につながる辺の数を合計し、2で割ると辺の数が得られます。

$n$ 個の対象を重複なくすべてペアにする場合：

$$ \boxed{E=\binom n2=\frac{n(n-1)}2} $$

### E17. 直線の交点（Line Intersections）

異なる $n$ 本の直線があり、どの二本も平行でなく、どの三本も同一点を通らない場合：

$$ \boxed{I=\binom n2} $$

計算方法： すべての直線から二本を選びます。それぞれの組が異なる一つの交点を作ります。

### E18. 円内の弦の交点（Circle Chord Intersections）

円周上に異なる $n$ 個の点があり、任意の二点を結び、どの三本の弦も円内の同一点で交わらない場合：

$$ \boxed{I=\binom n4} $$

計算方法： 円周上の四点ごとに、円内で交わる二本の弦が一組決まります。したがって $n$ 個の点から四つを選びます。

## F. 確率と統計（Probability & Statistics）

### F1. 古典的確率（Classical Probability）

すべての基本事象が同じ確率で起こるとき：

$$ \boxed{P(A)=\frac{N(A)}{N(S)}} $$

各記号の意味：

- $N(A)$：事象Aに当てはまる結果の数。
- $N(S)$：すべての基本結果の数。

計算方法： 条件に合う結果の数を求め、全結果数で割ります。

### F2. 余事象の確率（Complement Rule）

$$ \boxed{P(A^c)=1-P(A)} $$

計算方法： 1から反対の事象が起こる確率を引きます。

### F3. 確率の加法定理（Addition Rule）

$$ \boxed{P(A\cup B)=P(A)+P(B)-P(A\cap B)} $$

A、Bが互いに排反の場合：

$$ \boxed{P(A\cup B)=P(A)+P(B)} $$

計算方法： 二つの事象の確率を足し、重複して数えた共通部分の確率を引きます。

### F4. 確率の乗法定理（Multiplication Rule）

$$ \boxed{P(A\cap B)=P(A)P(B\mid A)} $$

A、Bが独立の場合：

$$ \boxed{P(A\cap B)=P(A)P(B)} $$

計算方法： 最初の事象の確率に、最初の事象が起きた後の第二の事象の条件付き確率を掛けます。

独立の場合、第二の事象の確率は最初の事象の影響を受けません。

### F5. 条件付き確率（Conditional Probability）

$$ \boxed{P(A\mid B)=\frac{P(A\cap B)}{P(B)}} $$

$P(B)>0$ が必要です。

計算方法： Bが起きたと分かっているとき、Bに該当する場合だけを考え、そのうちAも満たす割合を求めます。

### F6. 二項確率（Binomial Probability）

$$ \boxed{ P(X=k)=\binom nk p^k(1-p)^{n-k} } $$

各記号の意味：

- $n$：独立試行の回数。
- $k$：求める成功回数。
- $p$：各試行で成功する確率。
- $X$：成功の合計回数。

計算方法：

1. $k$ 回成功する位置の選び方を数えます。
2. $k$ 回成功する確率を掛けます。
3. 残りの $n-k$ 回が失敗する確率も掛けます。

各試行は互いに独立で、成功確率が同じでなければなりません。

### F7. 超幾何確率（Hypergeometric Probability）

異なる $N$ 個の対象から $n$ 個を非復元抽出し、そのうち目標の対象が $K$ 個あるとき、ちょうど $k$ 個の目標対象を引く確率：

$$ \boxed{ P(X=k)= \frac{\binom Kk\binom{N-K}{n-k}}{\binom Nn} } $$

計算方法： 目標の種類とそれ以外の種類から必要な数をそれぞれ選び、二つの組合せ数を掛けてから、選び方の総数で割ります。

### F8. 期待値（Expected Value）

$$ \boxed{E(X)=\sum_i x_iP(X=x_i)} $$

計算方法： 起こりうる各結果に対応する確率を掛けて、すべて足します。

期待値の線形性：

$$ \boxed{E(X+Y)=E(X)+E(Y)} $$

二つの確率変数が独立でなくても成り立ちます。

### F9. 幾何学的確率（Geometric Probability）

一様ランダムに選ぶ場合：

$$ \boxed{ P(A)=\frac{\text{Favourable Area}}{\text{Total Area}} } $$

線分上の点が長さに関して一様に分布する場合：

$$ \boxed{ P(A)=\frac{\text{Favourable Length}}{\text{Total Length}} } $$

計算方法： ランダムに選ぶ基本対象が面積、長さ、または別の測度のどれかを特定し、有利な部分と全体の比を求めます。

### F10. 平均値・中央値・最頻値・範囲（Mean, Median, Mode & Range）

平均値：

$$ \boxed{\bar x=\frac{\sum x_i}{n}} $$

範囲：

$$ \boxed{R=x_{\max}-x_{\min}} $$

計算方法：

- Mean：合計をデータ数で割ります。
- Median：データを並べ替えて中央の値を取ります。データ数が偶数の場合は中央二つの平均を取ります。
- Mode：最も頻繁に現れるデータを探します。
- Range：最大値から最小値を引きます。

## G. 平面幾何（Plane Geometry）

### G1. 基本的な角の規則（Basic Angle Rules）

平角：

$$ \boxed{180^\circ} $$

一周の角：

$$ \boxed{360^\circ} $$

対頂角：

$$ \boxed{\angle1=\angle2} $$

計算方法： 直線、交差する直線、平行線に関する角の関係から、等しい角や補角の方程式を立てます。

平行線を横切る直線がある場合：

- Corresponding Angles（同位角）は等しい。
- Alternate Interior Angles（錯角）は等しい。
- Co-interior Angles（同側内角）の和は $180^\circ$。

### G2. 三角形の内角の和（Triangle Angle Sum）

$$ \boxed{A+B+C=180^\circ} $$

外角の定理：

$$ \boxed{\text{Exterior Angle}=A+B} $$

ここでA、Bはその外角と隣り合わない二つの内角です。

計算方法： 二つの内角が分かっていれば180°から引きます。離れた二つの内角が分かっていれば、それらを足して対応する外角を求めます。

### G3. 二等辺三角形と正三角形（Isosceles & Equilateral Triangles）

二等辺三角形では、二つの辺が等しければ、それらに対する底角も等しくなります。

正三角形：

$$ \boxed{A=B=C=60^\circ} $$

辺の長さを $a$、高さを：

$$ \boxed{h=\frac{\sqrt3}{2}a} $$

面積：

$$ \boxed{S=\frac{\sqrt3}{4}a^2} $$

計算方法： 正三角形を高さで二つの30°–60°–90°の直角三角形に分け、辺の比から高さと面積を求めます。

### G4. 三角形の不等式（Triangle Inequality）

$$ \boxed{|a-b|<c<a+b} $$

ここで $a,b,c>0$ です。

計算方法： 二辺が分かっている場合、第三辺は二辺の差の絶対値より大きく、二辺の和より小さくなければなりません。

第三辺が整数に限られる場合は、この開区間に含まれる整数だけを数えます。

### G5. ピタゴラスの定理（Pythagorean Theorem）

直角三角形では：

$$ \boxed{a^2+b^2=c^2} $$

ここで $c$ は斜辺です。

計算方法： 二辺が分かっていれば、平方和または平方差を使って第三辺を求めます。

よく使われる整数辺の組：

| 直角をはさむ二辺 | 斜辺 |
| ----- | -- |
| 3、4   | 5  |
| 5、12  | 13 |
| 8、15  | 17 |
| 7、24  | 25 |
| 9、40  | 41 |
| 20、21 | 29 |

これらの組を同じ整数倍しても、ピタゴラスの定理を満たします。

### G6. 特殊な直角三角形（Special Right Triangles）

45°–45°–90°

$$ \boxed{1:1:\sqrt2} $$

30°–60°–90°

$$ \boxed{1:\sqrt3:2} $$

計算方法： 三角形の角度から該当する辺の比を特定し、与えられた辺の長さを比の単位として、ほかの辺の長さを求めます。

### G7. 三角形の面積（Triangle Area）

$$ \boxed{S=\frac12 bh} $$

各記号の意味：

- $b$：底辺。
- $h$：対応する底辺に垂直な高さ。

計算方法： 底辺に高さを掛けて2で割ります。

高さが等しい三角形：

$$ \boxed{\frac{S_1}{S_2}=\frac{b_1}{b_2}} $$

底辺が等しい三角形：

$$ \boxed{\frac{S_1}{S_2}=\frac{h_1}{h_2}} $$

### G8. ヘロンの公式（Heron's Formula）

$$ \boxed{s=\frac{a+b+c}{2}} $$

$$ \boxed{S=\sqrt{s(s-a)(s-b)(s-c)}} $$

ここで $s$ は半周長です。

計算方法： 三辺の長さが分かっている場合、まず半周長を求め、四つの因数を掛け合わせてから平方根を取ります。

### G9. 相似三角形（Similar Triangles）

二つの三角形が相似で、対応する辺の比が $k$ の場合：

$$ \boxed{\frac{a_1}{a_2}=k} $$

$$ \boxed{\frac{S_1}{S_2}=k^2} $$

計算方法： 対応する辺の比からほかの辺を求めます。面積比を求める場合は、辺の比を二乗します。

相似の判定条件：

- AA：対応する二つの角が等しい。
- SAS：対応する二組の辺が比例し、その間の角が等しい。
- SSS：対応する三組の辺が比例する。

### G10. 合同な三角形（Congruent Triangles）

よく使われる合同条件はSSS、SAS、ASA、AAS、RHS/HLです。

計算方法： 対応する辺や角が等しいかに基づいて合同を判定します。合同であれば、対応するすべての辺、角、面積がそれぞれ等しくなります。

### G11. 角の二等分線定理（Angle Bisector Theorem）

三角形 $ABC$ で、$AD$ が $\angle A$ の二等分線であり、$D$ が $BC$ 上にある場合：

$$ \boxed{\frac{BD}{DC}=\frac{AB}{AC}} $$

計算方法： 隣り合う二辺の比から、角の二等分線が対辺を分ける二つの部分の比を求めます。その後、$BD+DC=BC$ を使って長さを求めます。

### G12. 中線と重心（Median & Centroid）

$AD$ が三角形の中線で、$G$ が重心なら：

$$ \boxed{AG:GD=2:1} $$

したがって：

$$ \boxed{AG=\frac23AD} \qquad \boxed{GD=\frac13AD} $$

計算方法： 中線を3等分し、頂点から重心までが2つ分、重心から対辺の中点までが1つ分です。

中線は三角形の面積を二等分します：

$$ \boxed{S_1=S_2} $$

### G13. 内心と内接円（Incenter & Inradius）

$$ \boxed{S=rs} $$

各記号の意味：

- $r$：内接円の半径。
- $s$：三角形の半周長。
- $S$：三角形の面積。

計算方法： 面積を半周長で割ると内接円の半径が求まり、半径に半周長を掛けると面積が求まります。

### G14. 外心と外接円（Circumcenter & Circumradius）

$$ \boxed{S=\frac{abc}{4R}} $$

したがって：

$$ \boxed{R=\frac{abc}{4S}} $$

各記号の意味：

- $a,b,c$：三辺の長さ。
- $R$：外接円の半径。
- $S$：面積。

計算方法： 三辺と面積が分かっている場合、三辺を掛け合わせて面積の4倍で割ります。

直角三角形の場合：

$$ \boxed{R=\frac c2} $$

ここで $c$ は斜辺です。

### G15. 直角三角形の斜辺に対する高さ（Right Triangle Altitude Theorem）

斜辺が $c$ で、高さ $h$ によって $m,n$ に分けられる場合：

$$ \boxed{c=m+n} $$

$$ \boxed{h^2=mn} $$

二つの直角辺 $a,b$ がそれぞれの射影 $m,n$ に対応する場合：

$$ \boxed{a^2=cm} $$

$$ \boxed{b^2=cn} $$

計算方法： 相似な三角形の対応する辺の比から平方の関係を立て、高さや直角辺の長さを求めます。

### G16. 四角形（Quadrilaterals）

| 図形                  | 公式                    | 計算方法             |
| ------------------- | --------------------- | ---------------- |
| Rectangle 長方形       | $S=lw$            | 縦と横を掛ける              |
| Rectangle Perimeter | $P=2(l+w)$        | 縦と横の和を2倍する          |
| Square 正方形          | $S=a^2$           | 辺の長さを二乗する             |
| Square Diagonal     | $d=a\sqrt2$       | 辺の長さに $\sqrt2$ を掛ける |
| Parallelogram 平行四辺形 | $S=bh$            | 底辺に垂直な高さを掛ける            |
| Trapezoid 梯形        | $S=\frac12(a+b)h$ | 上底と下底の和に高さを掛けて2で割る     |
| Rhombus 菱形          | $S=\frac12d_1d_2$ | 二本の対角線の積を2で割る      |

ここで $l,w$ は縦と横、$b,h$ は底辺と垂直な高さ、$d_i$ は対角線の長さです。

### G17. 多角形の角（Polygon Angle Sum）

$n$ 角形の内角の和：

$$ \boxed{(n-2)180^\circ} $$

正 $n$ 角形の一つの内角：

$$ \boxed{\frac{(n-2)180^\circ}{n}} $$

正 $n$ 角形の一つの外角：

$$ \boxed{\frac{360^\circ}{n}} $$

計算方法： 辺の数 $n$ を該当する公式に代入します。凸多角形で各頂点から同じ向きに外角を一つずつ取ると、外角の和は $360^\circ$ です。

### G18. 多角形の対角線（Polygon Diagonals）

$$ \boxed{D=\frac{n(n-3)}2} $$

計算方法： 各頂点から、隣り合わない $n-3$ 個の頂点へ対角線を引けます。頂点数 $n$ を掛けてから2で割り、重複を除きます。

### G19. 正多角形の面積（Regular Polygon Area）

$$ \boxed{S=\frac12Pa} $$

各記号の意味：

- $P$：周長。
- $a$：Apothem（アポセム、内接半径）、つまり中心から辺に下ろした垂線の長さ。

計算方法： 周長にアポセムを掛けて2で割ります。

辺の長さが $s$ の正六角形：

$$ \boxed{S=\frac{3\sqrt3}{2}s^2} $$

### G20. 円（Circle）

円周：

$$ \boxed{C=2\pi r} $$

面積：

$$ \boxed{S=\pi r^2} $$

直径：

$$ \boxed{d=2r} $$

計算方法： 半径から直接計算します。

### G21. 弧の長さ（Arc Length）

中心角が $\theta^\circ$ の場合：

$$ \boxed{L=\frac{\theta}{360^\circ}2\pi r} $$

計算方法： 中心角を360°で割り、弧が円全体に占める割合を求めてから、円周を掛けます。

### G22. 扇形の面積（Sector Area）

$$ \boxed{S_{\mathrm{sector}}=\frac{\theta}{360^\circ}\pi r^2} $$

計算方法： 中心角が360°に占める割合に、円全体の面積を掛けます。

弓形の面積：

$$ \boxed{S_{\mathrm{segment}}=S_{\mathrm{sector}}-S_{\mathrm{triangle}}} $$

円環の面積：

$$ \boxed{S_{\mathrm{annulus}}=\pi(R^2-r^2)} $$

### G23. 円周角の定理（Inscribed Angle Theorem）

同じ弧に対して：

$$ \boxed{\theta_{\mathrm{inscribed}}=\frac12\theta_{\mathrm{central}}} $$

計算方法： 中心角を2で割ると、同じ弧に対する円周角が得られます。

半円に対する円周角：

$$ \boxed{90^\circ} $$

### G24. 円に内接する四角形（Cyclic Quadrilaterals）

円に内接する四角形 $ABCD$ では：

$$ \boxed{A+C=180^\circ} $$

$$ \boxed{B+D=180^\circ} $$

計算方法： 一つの内角が分かっていれば、$180^\circ$ から引くと対角が得られます。

### G25. 接線（Tangents）

接点における半径は接線に垂直です：

$$ \boxed{OT\perp PT} $$

同じ円の外部にある点Pから二本の接線PA、PBを引く場合：

$$ \boxed{PA=PB} $$

計算方法： 垂直の関係を使って直角三角形を立てるか、同じ外部の点から引いた接線の長さが等しい性質を使います。

### G26. 弦の長さ（Chord Length）

半径が $r$、円の中心から弦までの垂直距離が $d$ の場合：

$$ \boxed{L=2\sqrt{r^2-d^2}} $$

計算方法： 弦を二等分し、半弦の長さをピタゴラスの定理で求めてから2倍します。

### G27. 交わる弦の定理（Intersecting Chords Theorem）

円内で二つの弦 $AB,CD$ がPで交わる場合：

$$ \boxed{PA\cdot PB=PC\cdot PD} $$

計算方法： 交点の両側にある各弦の長さを掛け合わせ、二組の積を等しいとします。

### G28. 点の冪（Power of a Point）

円の外にある同一点Pから二本の割線を引く場合：

$$ \boxed{PA\cdot PB=PC\cdot PD} $$

ここでA、Cはそれぞれ円との近い交点、B、Dは遠い交点です。

接線PTと割線PABについて：

$$ \boxed{PT^2=PA\cdot PB} $$

計算方法： Pから遠い交点までの全長に、円外部分の長さを掛けます。接線の場合は接線の長さを二乗します。

### G29. 円の交角（Circle Intersection Angles）

円内で二つの弦が交わる場合：

$$ \boxed{\theta=\frac{\alpha+\beta}{2}} $$

円外で二本の割線が交わる場合：

$$ \boxed{\theta=\frac{\alpha-\beta}{2}} $$

ここで $\alpha,\beta$ は対応する弧の度数です。二つ目の公式では、遠い弧から近い弧を引きます。

計算方法： 交点が円の内側か外側かに応じて弧の度数の和または差を選び、2で割ります。

## H. 座標幾何（Coordinate Geometry）

### H1. 2点間の距離（Distance Formula）

$$ \boxed{ d=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2} } $$

計算方法： x座標の差の二乗とy座標の差の二乗を足し、平方根を取ります。

### H2. 中点（Midpoint Formula）

$$ \boxed{ M=\left(\frac{x_1+x_2}{2},\frac{y_1+y_2}{2}\right) } $$

計算方法： 二つのx座標の平均と、二つのy座標の平均をそれぞれ求めます。

### H3. 傾き（Slope）

$$ \boxed{m=\frac{y_2-y_1}{x_2-x_1}} $$

$x_1\ne x_2$ が必要です。

計算方法： y座標の変化量をx座標の変化量で割ります。

### H4. 直線の方程式（Equations of Lines）

傾き切片形：

$$ \boxed{y=mx+c} $$

点傾き形：

$$ \boxed{y-y_1=m(x-x_1)} $$

平行の条件（垂直でない直線）：

$$ \boxed{m_1=m_2} $$

垂直の条件（二直線の傾きが存在する場合）：

$$ \boxed{m_1m_2=-1} $$

計算方法： 一点と傾きが分かっていれば点傾き形を使います。二点が分かっていれば、先に傾きを求めてから、そのうちの一点を代入します。

### H5. 座標から三角形の面積を求める（Triangle Area from Coordinates）

$$ \boxed{ S=\frac12\left| x_1(y_2-y_3)+x_2(y_3-y_1)+x_3(y_1-y_2) \right| } $$

計算方法： 公式に沿って交差する項を掛けて足し、最後に絶対値を取って2で割ります。

### H6. 靴紐公式（Shoelace Formula）

境界に沿う順に並べた多角形の頂点：

$$ (x_1,y_1),\ldots,(x_n,y_n) $$

次のように定めます。

$$ x_{n+1}=x_1,\qquad y_{n+1}=y_1 $$

面積：

$$ \boxed{ S=\frac12\left| \sum_{i=1}^n x_i y_{i+1} - \sum_{i=1}^n y_i x_{i+1} \right| } $$

計算方法： 一方向の交差積を順に足し、逆方向の交差積も足します。二つの和の差の絶対値を取って2で割ります。

### H7. ピックの定理（Pick's Theorem）

頂点が整数格子点上にある単純多角形に適用します：

$$ \boxed{S=I+\frac B2-1} $$

各記号の意味：

- $I$：多角形の厳密な内部にある格子点の数。
- $B$：多角形の境界上にある格子点の数。

計算方法： 内部の格子点数に境界上の格子点数の半分を足し、1を引きます。

### H8. 座標変換（Coordinate Transformations）

| 変換             | 新しい座標             |
| -------------- | --------------- |
| x軸対称       | $(x,-y)$    |
| y軸対称       | $(-x,y)$    |
| 原点対称         | $(-x,-y)$   |
| 反時計回りに90°回転      | $(-y,x)$    |
| 時計回りに90°回転      | $(y,-x)$    |
| 180°回転        | $(-x,-y)$   |
| $(a,b)$ の平行移動 | $(x+a,y+b)$ |

回転の中心はすべて原点です。

## I. 立体幾何（Solid Geometry）

### I1. 立方体（Cube）

辺の長さが $a$ のとき：

$$ \boxed{V=a^3} $$

$$ \boxed{S=6a^2} $$

空間対角線：

$$ \boxed{d=a\sqrt3} $$

計算方法： 辺の長さの3乗で体積を求めます。表面積は同じ正方形六つの面積の合計です。空間対角線には三次元のピタゴラスの定理を使います。

### I2. 直方体（Rectangular Prism）

$$ \boxed{V=lwh} $$

$$ \boxed{S=2(lw+lh+wh)} $$

$$ \boxed{d=\sqrt{l^2+w^2+h^2}} $$

ここで $l,w,h$ はそれぞれ縦、横、高さです。

### I3. 円柱（Cylinder）

$$ \boxed{V=\pi r^2h} $$

$$ \boxed{S=2\pi r^2+2\pi rh} $$

計算方法： 底面積に高さを掛けて体積を求めます。二つの円形の底面積と側面積を足すと全表面積になります。

### I4. 円錐（Cone）

$$ \boxed{V=\frac13\pi r^2h} $$

側面積：

$$ \boxed{S_{\mathrm{lateral}}=\pi rl} $$

直円錐の場合：

$$ \boxed{l=\sqrt{r^2+h^2}} $$

ここで $l$ は母線の長さです。

全表面積：

$$ \boxed{S=\pi r^2+\pi rl} $$

### I5. 球（Sphere）

$$ \boxed{V=\frac43\pi r^3} $$

$$ \boxed{S=4\pi r^2} $$

計算方法： 半径の3乗に $4\pi/3$ を掛けて体積を求め、半径の二乗に $4\pi$ を掛けて表面積を求めます。

### I6. 角柱と角錐（Prism & Pyramid）

角柱：

$$ \boxed{V=S_{\mathrm{base}}h} $$

角錐：

$$ \boxed{V=\frac13S_{\mathrm{base}}h} $$

計算方法： 底面積に垂直な高さを掛けます。角錐の場合はさらに3で割ります。

### I7. 相似な立体（Similar Solids）

対応する長さの比が $k$ の場合：

$$ \boxed{\frac{S_1}{S_2}=k^2} $$

$$ \boxed{\frac{V_1}{V_2}=k^3} $$

計算方法： 面積比は長さの比の二乗、体積比は長さの比の三乗です。

### I8. オイラーの多面体公式（Euler's Polyhedron Formula）

凸多面体に対して：

$$ \boxed{V-E+F=2} $$

各記号の意味：

- $V$：頂点の数。
- $E$：辺の数。
- $F$：面の数。

計算方法： 分かっている二つの数を代入し、残る数を解きます。

## J. その他の数学的手法（Other Mathematical Techniques）

### J1. 偶奇性（Parity）

偶数：

$$ \boxed{2k} $$

奇数：

$$ \boxed{2k+1} $$

ここで $k\in\mathbb Z$ です。

計算方法： 整数の偶奇の表し方を使い、演算の結果を $2m$ または $2m+1$ の形に整理して、偶数か奇数かを判定します。

### J2. 不変量（Invariants）

ある操作で数が常に $km$ だけ変化する場合：

$$ \boxed{N_{\mathrm{new}}\equiv N_{\mathrm{old}}\pmod m} $$

計算方法： 各操作で変わらない余り、偶奇、色の個数の差などを探し、ある結果が実現できるかを判定します。

### J3. 上限と下限（Bounds）

$$ \boxed{L\le x\le U} $$

ここで $L$ は下限、$U$ は上限です。

計算方法： 非負性、大きさの比較、単調性、不等式を使って範囲を定め、選択肢や整数条件と照合します。

### J4. 対称式（Symmetric Expressions）

次が分かっている場合：

$$ s=a+b,\qquad p=ab $$

$$ \boxed{a^2+b^2=s^2-2p} $$

$$ \boxed{a^3+b^3=s^3-3ps} $$

$$ \boxed{(a-b)^2=s^2-4p} $$

計算方法： 二つの数の和と積で高次の式を表し、$a,b$ を先に求めずに計算します。

### J5. 時計の針の角度（Clock Angles）

12時間制を使い、$h\in\{0,1,\ldots,11\}$、$m$ は分を表す数とします。

時針の角度：

$$ \boxed{\theta_h=30h+0.5m} $$

分針の角度：

$$ \boxed{\theta_m=6m} $$

角度の差：

$$ \boxed{\Delta=|30h-5.5m|} $$

小さい方の角：

$$ \boxed{\theta=\min(\Delta,360^\circ-\Delta)} $$

計算方法： 12時の方向を基準に二つの針の角度をそれぞれ求め、差を取ってから小さい方の角を選びます。

### J6. 二重計数（Double Counting）

基本関係：

$$ \boxed{\text{Count by Method A}=\text{Count by Method B}} $$

計算方法： 同じ対象や関係を二つの異なる視点から数え、未知数を求める方程式を立てます。

よく使われる形：

$$ \boxed{\sum\deg(v)=2E} $$

### J7. 複数の非負数に対する相加相乗平均不等式（AM–GM for Multiple Numbers）

非負の実数 $x_1,\ldots,x_n$ に対して：

$$ \boxed{ \frac{x_1+\cdots+x_n}{n} \ge\sqrt[n]{x_1x_2\cdots x_n} } $$

計算方法： 非負変数の和が一定なら、この不等式を使って積の上限を求められます。積が一定の正数なら、和の下限を求められます。

すべての変数が等しいとき、等号が成り立ちます。

# 第2部：使う公式の見分け方

この部では、問題文の英語キーワード、既知の条件、求める量に沿って分類します。

同じキーワードでも複数の公式に対応する場合があります。問題の実際の条件に基づいて判断してください。

## 1. 算術と代数（Arithmetic & Algebra）

| 問題の条件 / English Keywords             | 見分け方        | 使用する公式                            |
| ----------------------------------- | ----------- | ------------------------------- |
| percentage increase / decrease      | 割合による増加または減少    | $N=O(1+r)$                  |
| average / mean                      | 合計と個数が分かっている     | $\bar x=\frac{\sum x_i}{n}$ |
| combined average                    | 異なる人数の複数グループ    | Weighted Average                |
| average speed                       | 総距離と総時間     | $v=\frac dt$                |
| same distance, different speeds     | 同じ距離の往復       | $\frac{2ab}{a+b}$           |
| working together                    | 複数人が同時に作業する    | $\frac1T=\frac1a+\frac1b$   |
| concentration / mixture             | 異なる濃度の混合      | 溶質の総量を混合物の総量で割る                     |
| constant difference                 | 隣り合う項の差が一定      | Arithmetic Sequence             |
| constant ratio                      | 隣り合う項の比が一定      | Geometric Sequence              |
| sum of consecutive integers         | 連続整数の和      | $\frac{n(n+1)}2$            |
| sum of squares                      | 連続整数の平方和    | $\frac{n(n+1)(2n+1)}6$      |
| sum of cubes                        | 連続整数の立方和    | $[\frac{n(n+1)}2]^2$        |
| fractional terms cancel             | 隣接する分数項が望遠鏡和になる   | Telescoping Sum                 |
| roots of a quadratic                | 解を求める        | Quadratic Formula               |
| sum/product of roots                | 解の和または積だけを求める    | Vieta's Formulas                |
| maximum / minimum of a quadratic    | 二次関数の極値      | Completing the Square           |
| fixed sum, maximum product          | 非負の変数の和が一定    | AM–GM                           |
| fixed positive product, minimum sum | 正の変数の積が一定     | AM–GM                           |
| distance from a number              | 数直線上の距離      | Absolute Value                  |
| coefficient of a term               | 二項展開の特定の項の係数 | Binomial Theorem                |
| exponential growth                  | 各期間の増加率が一定   | Compound Growth                 |

## 2. 数論（Number Theory）

| 問題の条件 / English Keywords               | 見分け方          | 使用する公式                                |
| ------------------------------------- | ------------- | ----------------------------------- |
| prime number                          | 素数かどうかを判定          | $\sqrt N$ 以下の素因数を確認する            |
| prime factorisation                   | 素因数分解         | $N=\prod p_i^{a_i}$             |
| number of positive divisors / factors | 正の約数の個数         | $\prod(a_i+1)$                  |
| sum of all factors                    | 正の約数の和         | $\prod(1+p_i+\cdots+p_i^{a_i})$ |
| product of all factors                | 正の約数の積         | $N^{d(N)/2}$                    |
| greatest common divisor               | 最大公約数         | GCD / Euclidean Algorithm           |
| least common multiple                 | 最小公倍数         | LCM                                 |
| relatively prime / coprime            | 二つの数が互いに素          | $\gcd(a,b)=1$                   |
| how many numbers are coprime to n     | 1からnまでで互いに素な数の個数 | Euler's Totient Function            |
| remainder when divided by             | 余りを求める           | Modular Arithmetic                  |
| last digit                            | 一の位を求める           | Modulo 10                           |
| last two digits                       | 下二桁を求める          | Modulo 100                          |
| large integer powers                  | 大きなべき乗の余り        | Powers Cycle / Fermat / Euler       |
| trailing zeros of n!                  | 階乗の末尾の0         | Legendre's Formula                  |
| perfect square                        | 平方数かを判定        | すべての素因数の指数が偶数であること                          |
| perfect cube                          | 立方数かを判定        | すべての素因数の指数が3の倍数であること                      |
| number of square divisors             | 平方数である約数の個数      | $\prod(\lfloor a_i/2\rfloor+1)$ |
| integer solutions                     | 整数方程式の解          | GCD / Modular Arithmetic            |
| multiples between A and B             | 区間内の倍数の個数        | Floor Function                      |
| binary / base-n                       | 進数の問題          | Positional Number Formula           |
| sum of digits                         | 各位の数字の和と整除        | Modulo 3 / 9                        |
| reversed digits                       | 数字の逆順          | 位取りによる展開                                |

## 3. 組合せ計数（Counting）

まず順序が重要かどうかを判断し、次に重複を許すかどうかを判断します。

| 順序が重要 | 重複を許す | 公式 | 適用する場合 |
| --- | --- | --- | --- |
| はい | いいえ | $P(n,r)=\frac{n!}{(n-r)!}$ | 異なる $n$ 個の対象から $r$ 個を選ぶ。順序が重要で、重複は認めない |
| はい | はい | $n^r$ | 毎回 $n$ 通りの選択肢から合計 $r$ 回選ぶ。順序が重要で、重複を認める |
| いいえ | いいえ | $\binom nr$ | 異なる $n$ 個の対象から $r$ 個を選ぶ。順序は問わず、重複は認めない |
| いいえ | はい | $\binom{n+r-1}{r}$ | $n$ 種類の対象から $r$ 個を選ぶ。順序は問わず、重複を認める |

この判断は、隣接、位置、数量の上下限などの追加制約がない基本的な選択問題に適用します。

その他の計数問題：

| English Keywords / 条件          | 見分け方        | 使用する公式                             |
| ------------------------------ | ----------- | -------------------------------- |
| identical objects              | 区別できない同一対象がある | Repeated Permutations            |
| around a round table           | 円形に並べ、回転を同じとみなす   | $(n-1)!$                     |
| necklace, flipping allowed     | 円形に並べ、裏返しも同じとみなす     | $(n-1)!/2$。対象が互いに異なるなどの条件が必要      |
| distribute identical items     | 同一の物を異なるグループに分ける   | Stars and Bars                   |
| nonnegative integer solutions  | 非負整数に分配      | $\binom{n+k-1}{k-1}$         |
| positive integer solutions     | 各変数が少なくとも1   | $\binom{n-1}{k-1}$           |
| at least one                   | 少なくとも一つ出現      | Complementary Counting           |
| neither A nor B                | どちらの条件も満たさない      | Complement / Inclusion–Exclusion |
| both A and B                   | 二条件の共通部分        | Intersection                     |
| adjacent / together            | 指定された対象が隣り合う    | Block Method                     |
| not adjacent                   | 指定された対象が隣り合わない    | Total − Adjacent                 |
| grid paths                     | 進行方向が決まった格子経路   | Lattice Paths                    |
| must pass through              | 指定された点を必ず通る      | 2区間の経路数を掛ける                         |
| cannot pass through            | 指定された点を通らない      | 全経路数からその点を通る経路数を引く                      |
| guaranteed / must occur        | どのような場合でも必ず起こる   | Pigeonhole Principle             |
| no one gets their own item     | すべての対象が元の位置から外れる      | Derangements                     |
| handshakes / pairwise meetings | 二者間の組み合わせ | $\binom n2$                  |

## 4. 確率（Probability）

| 問題の条件 / English Keywords   | 見分け方       | 使用する公式                         |
| ------------------------- | ---------- | ---------------------------- |
| probability of            | すべての結果が同様に確からしい      | 条件を満たす結果数 / 全結果数                 |
| at least one success      | 少なくとも1回成功     | $1-P(\text{no success})$ |
| either A or B             | AまたはBが起きる   | Addition Rule                |
| both A and B              | 二つの事象が両方起きる     | Multiplication Rule          |
| independent               | 事象が互いに影響しない     | $P(A)P(B)$               |
| given that                | ある事象が起きたと分かっている    | Conditional Probability      |
| without replacement       | 非復元抽出      | Conditional Probability / Hypergeometric        |
| exactly k successes       | 同じ独立試行を決まった回数だけ行う | Binomial Probability         |
| expected value            | 長期的な平均結果     | $\sum x_iP_i$            |
| random point in a region  | 領域内で一様に点を選ぶ   | 面積比                          |
| random point on a segment | 線分上で一様に点を選ぶ   | 長さの比                          |

## 5. 幾何（Geometry）

| 問題の条件 / English Keywords        | 見分け方       | 使用する公式                                  |
| ------------------------------ | ---------- | ------------------------------------- |
| right triangle                 | 直角三角形      | Pythagorean Theorem                   |
| 30°, 60°, 90°                  | 特殊な直角三角形    | $1:\sqrt3:2$                      |
| 45°, 45°, 90°                  | 二等辺直角三角形    | $1:1:\sqrt2$                      |
| three sides given, find area   | 三辺が分かり面積を求める    | Heron's Formula                       |
| similar triangles              | 対応する角が等しく、辺が比例する | Side Ratios / Area Ratios             |
| angle bisector                 | 角の二等分線が対辺を分ける    | Angle Bisector Theorem                |
| median                         | 頂点と対辺の中点を結ぶ     | Median Area Property                  |
| centroid                       | 三本の中線の交点     | $2:1$                             |
| inradius / incircle            | 三角形の内接円     | $S=rs$                            |
| circumradius / circumcircle    | 三角形の外接円    | $S=abc/(4R)$                      |
| altitude to hypotenuse         | 斜辺に下ろした高さ      | $h^2=mn$                          |
| regular polygon interior angle | 正多角形の内角     | $\frac{(n-2)180^\circ}{n}$        |
| number of diagonals            | 多角形の対角線の本数   | $n(n-3)/2$                        |
| arc length                     | 円弧の長さ       | $\frac{\theta}{360^\circ}2\pi r$  |
| sector area                    | 扇形の面積       | $\frac{\theta}{360^\circ}\pi r^2$ |
| inscribed angle                | 同じ弧に対する円周角      | 中心角の半分                                |
| angle subtended by diameter    | 直径に対する円周角    | $90^\circ$                        |
| cyclic quadrilateral           | 円に内接する四角形     | 対角の和が180°                                |
| tangent to a circle            | 円の接線と半径      | 垂直の関係                                  |
| two tangents from a point      | 同一の外部点から引いた二本の接線   | 接線の長さが等しい                                |
| intersecting chords            | 円内で二本の弦が交わる    | $PA\cdot PB=PC\cdot PD$           |
| secant and tangent             | 円外の割線と接線    | Power of a Point                      |
| distance from center to chord  | 円の中心から弦までの距離  | $L=2\sqrt{r^2-d^2}$               |
| lattice polygon                | 整数格子点上の多角形    | Pick's Theorem                        |

## 6. 座標幾何と立体幾何（Coordinate & Solid Geometry）

| 問題の条件        | 使用する公式                       |
| ----------- | -------------------------- |
| 2点間の距離      | Distance Formula           |
| 2点の中点        | Midpoint Formula           |
| 直線の傾き        | Slope Formula              |
| 点と傾きが分かっている   | Point–Slope Form           |
| 三頂点が分かっていて面積を求める   | Coordinate Triangle Area   |
| 多角形の頂点座標から面積を求める  | Shoelace Formula           |
| 座標の回転または反射     | Coordinate Transformations |
| 立方体または直方体の対角線  | 3D Pythagorean Theorem     |
| 円柱の体積        | $\pi r^2h$             |
| 円錐の体積        | $\frac13\pi r^2h$      |
| 球の体積         | $\frac43\pi r^3$       |
| 球の表面積        | $4\pi r^2$             |
| 相似な立体の面積比     | 長さの比の二乗                      |
| 相似な立体の体積比     | 長さの比の三乗                      |
| 多面体の頂点、辺、面の数 | Euler's Polyhedron Formula |


# 第3部：公式早見表

この部では、公式、英語名、必要な条件だけを掲載します。

## 1. 算術（Arithmetic）

| 英語名                        | 公式                                                      |
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

| 英語名               | 公式                                               |
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

適用条件：分母は0以外。対数の底は正で1以外、真数は正。根号や不等式はそれぞれの実数の定義域を満たすこと。

## 3. 数列と級数（Sequences & Series）

| 英語名                | 公式                                                    |
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

## 4. 数論（Number Theory）

| 英語名                    | 公式                                                     |
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

## 5. 組合せ計数（Combinatorics）

| 英語名                        | 公式                                                     |
| ------------------------------ | ------------------------------------------------------ |
| Addition Principle             | $N=N_1+\cdots+N_k$                                 |
| Multiplication Principle       | $N=N_1\cdots N_k$                                  |
| Ordered with Repetition        | $n^r$                                              |
| Permutations                   | $P(n,r)=\frac{n!}{(n-r)!}$                         |
| Combinations                   | $\binom nr=\frac{n!}{r!(n-r)!}$                    |
| Unordered with Repetition      | $\binom{n+r-1}{r}$                                 |
| Identical Object Permutations  | $\frac{n!}{a_1!\cdots a_k!}$                       |
| Circular Permutations          | $(n-1)!$                                           |
| Circular with Reflection       | $(n-1)!/2$, $n\ge3$。対象が互いに異なる                     |
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

計数公式は、順序、重複の有無、対象を区別できるかどうか、およびそのほかの条件を満たす場合に使います。

## 6. 確率と統計（Probability & Statistics）

| 英語名                    | 公式                                                       |
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

## 7. 三角形の幾何（Triangle Geometry）

| 英語名                     | 公式                               |
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

## 8. 多角形と円（Polygons & Circles）

| 英語名                        | 公式                                                    |
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

## 9. 座標幾何（Coordinate Geometry）

| 英語名                  | 公式                                                      |
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

傾きによる平行・垂直の公式は、該当する傾きが存在する場合に適用します。垂直線は別に判定してください。

## 10. 立体幾何（Solid Geometry）

| 英語名                        | 公式                            |
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

## 11. その他の公式（Additional Formulae）

| 英語名                     | 公式                                                                    |
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


---
title: AMC 10 완전 공식 가이드
description: AMC 10 산술, 대수, 정수론, 조합, 확률 및 기하 공식 설명, 문제 유형 판별법과 공식 요약표.
---

# AMC 10 완전 공식 가이드

# 제1부: 공식 설명

## A. 수학 기호 (Mathematical Notation)

| 기호                            | English                  | 의미와 계산 방법                           |
| ----------------------------- | ------------------------ | --------------------------------- |
| $\sum$                    | Summation                | 지정된 범위의 값을 차례로 대입해 모두 더함       |
| $\prod$                   | Product                  | 지정된 범위의 값을 차례로 대입해 모두 곱함       |
| $n!$                      | Factorial                | 1부터 $n$까지 곱하며, $0!=1$로 정의함 |
| $\binom nr$               | Combination              | 서로 다른 $n$개 대상 중 $r$개를 선택하며 순서는 중요하지 않음 |
| $\lfloor x\rfloor$        | Floor Function           | $x$ 이하인 가장 큰 정수                 |
| $\lceil x\rceil$          | Ceiling Function         | $x$ 이상인 가장 작은 정수               |
| $a\mid b$                 | Divisibility             | $b$가 $a$의 정수배임            |
| $a\equiv b\pmod m$        | Congruence               | $a-b$가 $m$의 정수배임          |
| $\gcd(a,b)$               | Greatest Common Divisor  | 최대공약수                             |
| $\operatorname{lcm}(a,b)$ | Least Common Multiple    | 최소공배수                             |
| $\varphi(n)$              | Euler's Totient Function | 1부터 $n$까지 중 $n$과 서로소인 양의 정수의 개수 |
| $\lvert x\rvert$          | Absolute Value           | $x$와 0 사이의 거리                   |
| $A\cap B$                 | Intersection             | A와 B에 동시에 속함                        |
| $A\cup B$                 | Union                    | A 또는 B에 속하며, 둘 다에 속해도 됨            |
| $A^c$                     | Complement               | A에 속하지 않음                             |
| $\mathbb Z$               | Integers                 | 정수 집합                              |
| $\mathbb R$               | Real Numbers             | 실수 집합                              |
| $\forall$                 | For All                  | 모든 ...에 대해                             |
| $\exists$                 | There Exists             | 적어도 하나 존재함                            |
| $\iff$                    | If and Only If           | 필요충분조건                              |

### A1. 합 (Summation)

$$ \boxed{\sum_{k=a}^{b}f(k)} $$

계산 방법: $k$를 $a$에서 시작해 1씩 증가시키며 $b$까지 넣고, 각 $f(k)$ 값을 모두 더합니다.

여기서:

- $k$: 각 항을 차례로 계산하는 변수입니다.
- $a$: 시작값입니다.
- $b$: 끝값입니다.
- $f(k)$: 각 항의 계산 규칙입니다.

### A2. 곱 (Product)

$$ \boxed{\prod_{k=a}^{b}f(k)} $$

계산 방법: $k$를 $a$부터 $b$까지 바꾸어 $f(k)$를 각각 계산한 뒤, 그 값을 모두 곱합니다.

$\sum$은 덧셈을, $\prod$는 곱셈을 합니다. 이것이 두 기호의 차이입니다.

### A3. 계승 (Factorial)

$$ \boxed{n!=n(n-1)(n-2)\cdots2\cdot1} $$

여기서 $n$은 음이 아닌 정수이며, $0!=1$입니다.

계산 방법: $n$에서 시작해 1씩 줄이며 모든 양의 정수를 곱합니다.

## B. 산술 (Arithmetic)

### B1. 분수 (Fractions)

덧셈과 뺄셈:

$$ \boxed{\frac ab\pm\frac cd=\frac{ad\pm bc}{bd}} $$

곱셈:

$$ \boxed{\frac ab\cdot\frac cd=\frac{ac}{bd}} $$

나눗셈:

$$ \boxed{\frac ab\div\frac cd=\frac{ad}{bc}} $$

계산 방법:

- 덧셈과 뺄셈: 분모를 통분한 다음 분자를 더하거나 뺍니다.
- 곱셈: 분자는 분자끼리, 분모는 분모끼리 곱합니다.
- 나눗셈: 나누는 분수를 뒤집은 다음 곱합니다.
- 마지막으로 약분합니다.

모든 분모는 0이 아니어야 하며, 나누는 수 역시 0일 수 없습니다.

### B2. 비 (Ratios)

다음과 같다면:

$$ a:b=m:n $$

그러면:

$$ \boxed{a=km,\qquad b=kn} $$

전체량 $S=a+b$를 알 때:

$$ \boxed{a=\frac{m}{m+n}S} $$

$$ \boxed{b=\frac{n}{m+n}S} $$

계산 방법: 비의 각 항을 더해 전체 몫의 수를 구한 뒤, 각 항의 비율만큼 전체량을 나눕니다.

### B3. 정비례와 반비례 (Direct & Inverse Proportion)

정비례:

$$ \boxed{y=kx} $$

반비례:

$$ \boxed{xy=k} $$

여기서 $k$는 비례상수입니다.

계산 방법:

- 정비례: 한 쌍의 $x,y$가 주어지면 $k=y/x$를 계산합니다.
- 반비례: 한 쌍의 $x,y$가 주어지면 $k=xy$를 계산합니다.
- 같은 $k$를 사용해 다른 값을 구합니다.

### B4. 백분율 변화 (Percentage Change)

$$ \boxed{N=O(1+r)} $$

여기서:

- $O$: Original Value, 원래 값입니다.
- $N$: New Value, 새로운 값입니다.
- $r$: 부호를 포함한 변화율이며 소수로 나타냅니다.

계산 방법:

- $r$만큼 증가: 원래 값에 $1+r$을 곱합니다.
- $r$만큼 감소: 원래 값에 $1-r$을 곱합니다. 이때 $r$은 양수인 감소율입니다.

변화율을 거꾸로 구하기:

$$ \boxed{r=\frac{N-O}{O}} $$

여러 번 연속해서 변할 때:

$$ \boxed{N=O(1+r_1)(1+r_2)\cdots(1+r_k)} $$

각 변화는 직전 변화 후의 값을 기준으로 합니다.

### B5. 산술평균 (Arithmetic Mean)

$$ \boxed{\bar x=\frac{x_1+x_2+\cdots+x_n}{n}} $$

계산 방법: 모든 자료를 더한 뒤 자료의 개수로 나눕니다.

합계 역산:

$$ \boxed{\text{Sum}=n\bar x} $$

### B6. 가중평균 (Weighted Average)

$$ \boxed{ \bar x=\frac{w_1x_1+w_2x_2+\cdots+w_nx_n} {w_1+w_2+\cdots+w_n} } $$

여기서 $w_i$는 해당 값의 가중치입니다.

계산 방법: 각 값에 해당 가중치를 곱해 모두 더한 다음, 가중치의 합으로 나눕니다.

### B7. 속력, 거리와 시간 (Speed, Distance & Time)

$$ \boxed{d=vt} $$

$$ \boxed{v=\frac dt} \qquad \boxed{t=\frac dv} $$

여기서:

- $d$: Distance, 이동 거리입니다.
- $v$: Speed, 속력입니다.
- $t$: Time, 시간입니다.

계산 방법: 주어진 두 양으로 나머지 하나를 구합니다. 단위가 서로 일치하는지 확인합니다.

평균 속력:

$$ \boxed{v_{\mathrm{avg}}=\frac{\text{Total Distance}}{\text{Total Time}}} $$

같은 거리를 왕복하고 속력이 각각 $v_1,v_2$일 때:

$$ \boxed{v_{\mathrm{avg}}=\frac{2v_1v_2}{v_1+v_2}} $$

서로 마주 보고 움직일 때 접근 속력은 $v_1+v_2$입니다. 같은 방향으로 따라잡을 때의 속력은 두 속력의 차이며, 추격하는 쪽이 더 빠른 경우입니다.

### B8. 작업률 (Work & Rate)

$$ \boxed{W=rt} $$

여기서:

- $W$: 완료한 작업량입니다.
- $r$: 단위 시간당 작업량입니다.
- $t$: 작업 시간입니다.

A와 B가 같은 작업을 각각 혼자서 완료하는 데 $a,b$시간이 걸리고, 서로 독립적으로 동시에 일할 수 있다면:

$$ \boxed{\frac1T=\frac1a+\frac1b} $$

$$ \boxed{T=\frac{ab}{a+b}} $$

계산 방법: 각자의 작업률을 더한 뒤 전체 작업량을 총 작업률로 나눕니다.

### B9. 혼합물과 농도 (Mixtures & Concentrations)

$$ \boxed{c=\frac{m_{\mathrm{solute}}}{m_{\mathrm{solution}}}} $$

여기서:

- $c$: 농도 또는 질량분율입니다.
- $m_{\mathrm{solute}}$: 용질의 질량입니다.
- $m_{\mathrm{solution}}$: 용액의 질량입니다.

용질 손실 없이 혼합할 때:

$$ \boxed{ c_{\mathrm{new}}= \frac{m_1c_1+m_2c_2}{m_1+m_2} } $$

계산 방법: 각 부분의 용질 질량을 구해 더한 다음, 혼합물의 전체 질량으로 나눕니다.

### B10. 복리 성장 (Compound Growth)

$$ \boxed{A=P(1+r)^n} $$

여기서:

- $P$: 초기량입니다.
- $A$: 최종량입니다.
- $r$: 주기별 증가율입니다.
- $n$: 주기의 수입니다.

계산 방법: 매 주기 같은 성장 계수를 곱하고 이를 $n$회 반복합니다.

매 주기 $r>0$의 비율만큼 감소한다면:

$$ \boxed{A=P(1-r)^n} $$

## C. 대수 (Algebra)

### C1. 지수 법칙 (Exponent Laws)

$$ \boxed{a^ma^n=a^{m+n}} $$

$$ \boxed{\frac{a^m}{a^n}=a^{m-n}} $$

$$ \boxed{(a^m)^n=a^{mn}} $$

$$ \boxed{(ab)^n=a^nb^n} $$

$$ \boxed{a^{-n}=\frac1{a^n}} $$

$$ \boxed{a^{1/n}=\sqrt[n]{a}} $$

계산 방법:

- 밑이 같은 곱셈: 지수를 더합니다.
- 밑이 같은 나눗셈: 지수를 뺍니다.
- 거듭제곱의 거듭제곱: 지수를 곱합니다.
- 음의 지수: 역수를 취합니다.
- 분수 지수: 분모는 거듭제곱근의 차수, 분자는 거듭제곱의 지수를 나타냅니다.

나눗셈에서는 해당 밑이 0이 아니어야 합니다. 짝수 차수의 근호가 나오면 실수 범위에서 정의되는 조건도 확인해야 합니다.

### C2. 대수 항등식 (Algebraic Identities)

$$ \boxed{(a+b)^2=a^2+2ab+b^2} $$

$$ \boxed{(a-b)^2=a^2-2ab+b^2} $$

$$ \boxed{a^2-b^2=(a-b)(a+b)} $$

$$ \boxed{a^3+b^3=(a+b)(a^2-ab+b^2)} $$

$$ \boxed{a^3-b^3=(a-b)(a^2+ab+b^2)} $$

$$ \boxed{(a+b)^3=a^3+3a^2b+3ab^2+b^3} $$

$$ \boxed{(a-b)^3=a^3-3a^2b+3ab^2-b^3} $$

계산 방법: 식이 제곱, 세제곱 또는 제곱의 차 형태인지 확인해 전개하거나 인수분해합니다.

### C3. 이차방정식의 근의 공식 (Quadratic Formula)

다음 방정식에 대해:

$$ ax^2+bx+c=0,\qquad a\ne0 $$

다음이 성립합니다:

$$ \boxed{x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}} $$

판별식:

$$ \boxed{\Delta=b^2-4ac} $$

계산 방법: $a,b,c$를 확인하고 $\Delta$를 계산한 다음 근의 공식에 대입합니다.

- $\Delta>0$: 서로 다른 두 실근이 있습니다.
- $\Delta=0$: 중복된 실근 하나가 있습니다.
- $\Delta<0$: 실근이 없습니다.

### C4. 비에타 공식 (Vieta's Formulas)

$r_1,r_2$가 이차방정식 $ax^2+bx+c=0$의 두 근이라면:

$$ \boxed{r_1+r_2=-\frac ba} $$

$$ \boxed{r_1r_2=\frac ca} $$

계산 방법: 근을 먼저 구할 필요 없이 계수만으로 근의 합과 곱을 계산합니다.

더 나아가:

$$ \boxed{r_1^2+r_2^2=(r_1+r_2)^2-2r_1r_2} $$

$$ \boxed{(r_1-r_2)^2=(r_1+r_2)^2-4r_1r_2} $$

알려진 근의 합과 곱을 이 항등식에 대입합니다.

### C5. 완전제곱식 만들기 (Completing the Square)

$$ \boxed{ ax^2+bx+c= a\left(x+\frac{b}{2a}\right)^2+ c-\frac{b^2}{4a} } $$

여기서 $a\ne0$입니다.

계산 방법:

1. 이차항의 계수 $a$를 묶어 냅니다.
2. 괄호 안 일차항의 계수를 2로 나눕니다.
3. 완전제곱식으로 씁니다.
4. 남은 상수항을 조정합니다.

$a>0$이면 함수의 최솟값은 다음과 같습니다:

$$ \boxed{c-\frac{b^2}{4a}} $$

$a<0$이면 같은 값이 최댓값입니다.

극값은 다음 위치에서 발생합니다:

$$ \boxed{x=-\frac b{2a}} $$

### C6. 절댓값 (Absolute Value)

$$ \boxed{ |x|= \begin{cases} x,&x\ge0\\ -x,&x<0 \end{cases} } $$

절댓값 방정식:

$$ |x-a|=d $$

$d\ge0$일 때:

$$ \boxed{x=a\pm d} $$

계산 방법: 절댓값을 거리로 해석한 뒤, 해당 거리를 만족하는 위치를 좌우 양쪽에서 찾습니다.

$d>0$일 때:

$$ \boxed{|x-a|<d\iff a-d<x<a+d} $$

$$ \boxed{|x-a|>d\iff x<a-d\text{ 或 }x>a+d} $$

### C7. 근호 (Radicals)

$$ \boxed{\sqrt{ab}=\sqrt a\sqrt b} \quad(a,b\ge0) $$

$$ \boxed{\sqrt{a^2}=|a|} $$

분모 유리화:

$$ \boxed{ \frac1{a+\sqrt b} =\frac{a-\sqrt b}{a^2-b} } $$

실수 범위에서 $b\ge0$, $a^2\ne b$이어야 합니다. 그러면 원래 식과 유리화한 식의 분모가 모두 0이 되지 않습니다.

계산 방법: 분자와 분모에 분모의 켤레식을 곱해 제곱의 차를 이용하여 분모의 근호를 없앱니다.

### C8. 산술·기하평균 부등식 (Arithmetic–Geometric Mean Inequality)

음이 아닌 실수 $a,b$에 대해:

$$ \boxed{\frac{a+b}{2}\ge\sqrt{ab}} $$

다음과 동치입니다:

$$ \boxed{(a+b)^2\ge4ab} $$

계산 방법:

- 합이 주어졌을 때 곱의 최댓값을 구하려면 $ab\le(a+b)^2/4$를 사용합니다.
- 양의 곱이 주어졌을 때 합의 최솟값을 구하려면 $a+b\ge2\sqrt{ab}$를 사용합니다.

등호는 $a=b$일 때, 그리고 그때에만 성립합니다.

음이 아닌 실수 $n$개에 대해:

$$ \boxed{ \frac{x_1+\cdots+x_n}{n} \ge\sqrt[n]{x_1x_2\cdots x_n} } $$

### C9. 코시-슈바르츠 부등식 (Cauchy–Schwarz Inequality)

$$ \boxed{ (a^2+b^2)(c^2+d^2)\ge(ac+bd)^2 } $$

일반형:

$$ \boxed{ \left(\sum_{i=1}^n a_i^2\right) \left(\sum_{i=1}^n b_i^2\right) \ge \left(\sum_{i=1}^n a_ib_i\right)^2 } $$

계산 방법: 구하려는 식을 두 제곱합과 그에 대응하는 곱의 합으로 나타낸 뒤, 부등식으로 상한이나 하한을 구합니다.

자주 쓰이는 따름정리:

$$ \boxed{a^2+b^2\ge\frac{(a+b)^2}{2}} $$

### C10. 등차수열 (Arithmetic Sequences)

$$ \boxed{a_n=a_1+(n-1)d} $$

$$ \boxed{S_n=\frac n2(a_1+a_n)} $$

$$ \boxed{S_n=\frac n2[2a_1+(n-1)d]} $$

여기서:

- $a_1$: 첫째 항입니다.
- $a_n$: 제 $n$항입니다.
- $d$: 공차입니다.
- $S_n$: 첫 $n$개 항의 합입니다.

계산 방법:

- 특정 항 구하기: 첫째 항에 공차를 $n-1$번 더합니다.
- 합 구하기: 항의 개수에 첫째 항과 마지막 항의 평균을 곱합니다.
- 항의 개수 구하기: 합 또는 특정 항을 방정식에 대입해 $n$을 구한 다음 양의 정수인지 확인합니다.

### C11. 등비수열 (Geometric Sequences)

$$ \boxed{a_n=a_1r^{n-1}} $$

$r\ne1$일 때:

$$ \boxed{S_n=a_1\frac{1-r^n}{1-r}} $$

$|r|<1$이면:

$$ \boxed{S_\infty=\frac{a_1}{1-r}} $$

계산 방법: 각 항에 일정한 공비 $r$을 곱합니다. 필요한 값에 따라 제 $n$항, 유한합 또는 무한합 공식을 선택합니다.

$r=1$이면 유한합은 바로 $na_1$입니다.

### C12. 자주 쓰이는 합 (Standard Sums)

처음 $n$개의 양의 정수:

$$ \boxed{\sum_{k=1}^n k=\frac{n(n+1)}2} $$

처음 $n$개의 양의 정수의 제곱:

$$ \boxed{\sum_{k=1}^n k^2=\frac{n(n+1)(2n+1)}6} $$

처음 $n$개의 양의 정수의 세제곱:

$$ \boxed{\sum_{k=1}^n k^3=\left[\frac{n(n+1)}2\right]^2} $$

처음 $n$개의 양의 홀수:

$$ \boxed{\sum_{k=1}^n(2k-1)=n^2} $$

처음 $n$개의 양의 짝수:

$$ \boxed{\sum_{k=1}^n2k=n(n+1)} $$

계산 방법: 합의 대상이 연속된 정수, 제곱, 세제곱, 홀수 또는 짝수인지 확인한 후 항의 개수를 대입합니다.

### C13. 망원급수 (Telescoping Sums)

$$ \boxed{\frac1{k(k+1)}=\frac1k-\frac1{k+1}} $$

따라서:

$$ \boxed{ \sum_{k=1}^n\frac1{k(k+1)} =1-\frac1{n+1} =\frac n{n+1} } $$

계산 방법:

1. 각 항을 두 분수의 차로 나눕니다.
2. 앞뒤로 인접한 몇 항을 펼쳐 씁니다.
3. 부호가 반대인 같은 항끼리 서로 소거합니다.
4. 소거되지 않은 처음과 끝 항만 계산합니다.

### C14. 이항정리 (Binomial Theorem)

$$ \boxed{(a+b)^n=\sum_{r=0}^{n}\binom nr a^{n-r}b^r} $$

여기서:

$$ \boxed{\binom nr=\frac{n!}{r!(n-r)!}} $$

제 $r+1$항:

$$ \boxed{T_{r+1}=\binom nr a^{n-r}b^r} $$

계산 방법:

1. 전체 지수 $n$을 확인합니다.
2. 몇 번째 항 또는 어떤 거듭제곱 항을 구하는지 확인합니다.
3. 해당하는 $r$을 찾습니다.
4. 조합의 수와 두 인수의 거듭제곱을 계산합니다.
5. 음수가 포함되어 있다면 해당 거듭제곱에도 음수를 대입합니다.

자주 쓰이는 조합 항등식:

$$ \boxed{\binom nr=\binom n{n-r}} $$

$$ \boxed{\binom nr+\binom n{r-1}=\binom{n+1}r} $$

$$ \boxed{\sum_{r=0}^{n}\binom nr=2^n} $$

### C15. 로그 (Logarithms)

$$ \boxed{a^x=b\iff x=\log_a b} $$

여기서 $a>0$, $a\ne1$, $b>0$입니다.

$$ \boxed{\log_a(xy)=\log_a x+\log_a y} $$

$$ \boxed{\log_a\frac xy=\log_a x-\log_a y} $$

$$ \boxed{\log_a(x^r)=r\log_a x} $$

밑 변환 공식:

$$ \boxed{\log_a b=\frac{\log_c b}{\log_c a}} $$

계산 방법: 로그 문제를 지수 문제로 바꾸어 생각하거나, 곱셈·나눗셈·거듭제곱에 대한 로그 법칙을 이용해 식을 합치거나 나눕니다. 모든 진수는 양수여야 합니다.

## D. 정수론 (Number Theory)

### D1. 나누어떨어짐 (Divisibility)

$$ \boxed{a\mid b\iff b=ak,\quad k\in\mathbb Z,\quad a\ne0} $$

계산 방법: $a\ne0$이라고 가정합니다. $b/a$가 정수인지 확인하거나, $b$를 $a$의 정수배로 나타낼 수 있는지 확인합니다.

나누어떨어짐의 성질:

$$ \boxed{ a\mid b,\ a\mid c \Longrightarrow a\mid(mb+nc) } $$

여기서 $m,n$은 정수입니다.

즉, $a$가 $b,c$를 모두 나누면 이들의 임의의 정수 선형결합도 나눕니다.

### D2. 나눗셈 판정법 (Divisibility Tests)

| 나누는 수 | 판정 방법                         |
| -- | ---------------------------- |
| 2  | 일의 자리 숫자가 짝수인지 확인                    |
| 3  | 각 자리 숫자의 합이 3의 배수인지 확인                 |
| 4  | 끝의 두 자리로 만든 수를 확인                    |
| 5  | 일의 자리 숫자가 0 또는 5인지 확인                |
| 6  | 2와 3의 판정법을 모두 만족하는지 확인                 |
| 8  | 끝의 세 자리로 만든 수를 확인                    |
| 9  | 각 자리 숫자의 합이 9의 배수인지 확인              |
| 10 | 일의 자리 숫자가 0인지 확인                    |
| 11 | 한쪽 끝에서 시작해 각 자리 숫자를 번갈아 더하고 빼며, 결과가 11의 배수인지 확인 |
| 12 | 3과 4의 판정법을 모두 만족하는지 확인                 |
| 25 | 끝의 두 자리로 만든 수가 25로 나누어떨어지는지 확인               |

### D3. 소수 (Prime Numbers)

정수 $p>1$가 소수라는 것은 양의 약수가 1과 $p$뿐이라는 뜻입니다.

계산 방법: $N>1$이 소수인지 확인할 때는 다음 조건만 검사하면 됩니다:

$$ \boxed{p\le\sqrt N} $$

이 범위에 있는 소수 $p$ 중 $N$을 나누는 수가 있는지 확인합니다.

어떤 수도 나누어떨어지지 않으면 $N$은 소수입니다.

### D4. 소인수분해 (Prime Factorisation)

$N>1$일 때:

$$ \boxed{N=p_1^{a_1}p_2^{a_2}\cdots p_k^{a_k}} $$

계산 방법: 작은 소수부터 차례로 나누어 보고, 같은 소인수는 지수 형태로 묶습니다.

여기서 $p_i$는 서로 다른 소수이고, $a_i$는 양의 정수입니다.

### D5. 양의 약수의 개수 (Number of Divisors)

$$ \boxed{d(N)=\prod_{i=1}^k(a_i+1)} $$

전개한 형태:

$$ \boxed{d(N)=(a_1+1)(a_2+1)\cdots(a_k+1)} $$

계산 방법: 각 소인수의 지수에 1을 더한 뒤 모두 곱합니다.

$N=1$일 때 약수의 개수는 1입니다.

### D6. 양의 약수의 합 (Sum of Divisors)

$$ \boxed{ \sigma(N)= \prod_{i=1}^k \left(1+p_i+p_i^2+\cdots+p_i^{a_i}\right) } $$

동치인 식:

$$ \boxed{ \sigma(N)= \prod_{i=1}^k \frac{p_i^{a_i+1}-1}{p_i-1} } $$

계산 방법: 각 소인수에 대해 0제곱부터 최고차항까지 모두 더한 뒤, 각 묶음의 합을 곱합니다.

### D7. 양의 약수의 곱 (Product of Divisors)

$$ \boxed{P(N)=N^{d(N)/2}} $$

계산 방법: 먼저 양의 약수의 개수 $d(N)$를 구하고, 이를 2로 나눈 값을 $N$의 지수로 사용합니다.

$d(N)$이 홀수여도 이 공식은 성립합니다.

### D8. 완전제곱수인 약수의 개수 (Square Divisors)

$$ \boxed{ d_{\mathrm{square}}(N)= \prod_{i=1}^k \left(\left\lfloor\frac{a_i}{2}\right\rfloor+1\right) } $$

계산 방법: 각 소인수의 지수가 0부터 $a_i$까지일 때 짝수가 몇 개 있는지 세고, 그 선택의 수를 모두 곱합니다.

### D9. 완전거듭제곱 (Perfect Powers)

양의 정수 $N$이 완전한 $m$제곱수일 필요충분조건은 소인수분해의 모든 지수가 $m$의 배수인 것입니다.

$$ \boxed{ N=x^m\iff m\mid a_i\text{ 对所有 }i } $$

계산 방법: 소인수분해한 다음 각 지수가 $m$으로 나누어떨어지는지 확인합니다.

### D10. 최대공약수와 최소공배수 (GCD & LCM)

$$ \boxed{\gcd(a,b)\operatorname{lcm}(a,b)=ab} $$

여기서 $a,b$는 양의 정수입니다.

다음과 같이 두면:

$$ a=\prod p_i^{\alpha_i}, \qquad b=\prod p_i^{\beta_i} $$

나타나지 않는 소인수의 지수는 0으로 간주하면:

$$ \boxed{\gcd(a,b)=\prod p_i^{\min(\alpha_i,\beta_i)}} $$

$$ \boxed{\operatorname{lcm}(a,b)=\prod p_i^{\max(\alpha_i,\beta_i)}} $$

계산 방법:

- 최대공약수: 각 소인수에서 더 작은 지수를 취합니다.
- 최소공배수: 각 소인수에서 더 큰 지수를 취합니다.

### D11. 유클리드 알고리즘 (Euclidean Algorithm)

$$ \boxed{\gcd(a,b)=\gcd(b,a\bmod b)} $$

계산 방법: 나머지가 0이 될 때까지 원래의 두 수를 “나누는 수와 나머지”로 반복해서 바꿉니다. 마지막으로 0이 아닌 나머지가 GCD입니다.

### D12. 서로소 (Coprime)

$$ \boxed{\gcd(a,b)=1} $$

계산 방법: 두 수가 1보다 큰 공통 소인수를 갖는지 확인합니다.

연속한 정수는 다음을 만족합니다:

$$ \boxed{\gcd(n,n+1)=1} $$

### D13. 오일러 피 함수 (Euler's Totient Function)

$$ \boxed{ \varphi(N)=N\prod_{p\mid N}\left(1-\frac1p\right) } $$

여기서:

- $N$: 서로소인 수의 개수를 구할 양의 정수입니다.
- $p\mid N$: $p$는 $N$의 소인수입니다.
- $\prod_{p\mid N}$: 서로 다른 소인수를 각각 한 번씩 취해 해당 인수를 곱합니다.

말로 풀어 쓴 계산식:

$$ \boxed{ \varphi(N)= N\times \frac{p_1-1}{p_1}\times \frac{p_2-1}{p_2}\times\cdots\times \frac{p_k-1}{p_k} } $$

계산 방법: 소인수분해 → 서로 다른 소인수를 각각 한 번씩 취함 → 해당 분수를 계산함 → $N$에 차례로 곱함.

$p$가 소수일 때:

$$ \boxed{\varphi(p)=p-1} $$

$p$가 소수이고 $a\ge1$일 때:

$$ \boxed{\varphi(p^a)=p^a-p^{a-1}} $$

다음도 정의합니다:

$$ \boxed{\varphi(1)=1} $$

### D14. 합동식 (Modular Arithmetic)

$$ \boxed{a\equiv b\pmod m} $$

다음과 동치입니다:

$$ \boxed{m\mid(a-b)} $$

여기서 법 $m$은 양의 정수입니다.

계산 방법: $a,b$를 각각 $m$으로 나눈 나머지를 구해 서로 같은지 확인합니다.

연산 규칙:

$$ \boxed{(a+b)\bmod m=((a\bmod m)+(b\bmod m))\bmod m} $$

$$ \boxed{(ab)\bmod m=((a\bmod m)(b\bmod m))\bmod m} $$

$$ \boxed{a^n\bmod m=((a\bmod m)^n)\bmod m} $$

마지막 공식은 음이 아닌 정수 지수에 적용됩니다.

주의: 합동식에서는 나눗셈을 임의로 해서는 안 됩니다.

### D15. 나머지 표현 (Remainder Representation)

$$ \boxed{N=dq+r} $$

여기서:

$$ \boxed{0\le r<d} $$

$d$는 양의 제수, $q$는 정수 몫, $r$은 나머지입니다.

계산 방법: “$d$로 나누었을 때 나머지가 $r$”이라는 조건을 $N=dq+r$로 바꾸고, 다른 조건을 이용해 정수 $q$를 구합니다.

### D16. 일의 자리 숫자의 주기 (Units Digit Cycles)

$$ \boxed{\text{Last digit of }N=N\bmod10} $$

거듭제곱 $a^n$에서는 먼저 일의 자리 숫자의 주기 길이 $L$을 찾습니다.

그다음:

$$ \boxed{r=n\bmod L} $$

계산 방법: 지수를 $r$로 나눈 나머지에 따라 주기 안의 위치를 찾습니다. $r=0$이면 주기의 마지막 항을 취합니다.

| 밑의 일의 자리 숫자 | 주기 순서    |
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

이 표는 양의 정수 지수에 적용됩니다.

끝의 두 자리를 구할 때는 법 100을, 끝의 세 자리를 구할 때는 법 1000을 사용하며 주기를 새로 찾아야 합니다.

### D17. 페르마의 소정리 (Fermat's Little Theorem)

$p$가 소수이고 $p\nmid a$이면:

$$ \boxed{a^{p-1}\equiv1\pmod p} $$

계산 방법: 큰 지수를 $p-1$씩 묶어, 각 묶음의 거듭제곱이 법 $p$에서 1과 합동이라는 성질로 계산을 간단히 합니다.

### D18. 오일러 정리 (Euler's Theorem)

다음 조건에서:

$$ \gcd(a,m)=1 $$

그러면:

$$ \boxed{a^{\varphi(m)}\equiv1\pmod m} $$

계산 방법: 먼저 $\varphi(m)$을 계산한 뒤, 지수의 주기성을 이용해 거듭제곱의 나머지를 간단히 구합니다.

### D19. 계승의 소인수 지수 (Factorial Prime Exponents)

$$ \boxed{ v_p(n!)= \sum_{j=1}^{\infty} \left\lfloor\frac n{p^j}\right\rfloor } $$

여기서 $p$는 소수여야 합니다.

말로 풀어 쓴 계산식:

$$ \boxed{ \left\lfloor\frac np\right\rfloor+ \left\lfloor\frac n{p^2}\right\rfloor+ \left\lfloor\frac n{p^3}\right\rfloor+\cdots } $$

계산 방법: $p,p^2,p^3,\ldots$로 차례로 나누고 매번 내림한 값을 더합니다. 몫이 1보다 작아지면 멈춥니다.

### D20. 계승의 끝자리 0의 개수 (Trailing Zeros)

10진법에서:

$$ \boxed{ Z(n!)= \left\lfloor\frac n5\right\rfloor+ \left\lfloor\frac n{25}\right\rfloor+ \left\lfloor\frac n{125}\right\rfloor+\cdots } $$

계산 방법: $n!$에 들어 있는 인수 5의 총 지수를 계산합니다. 인수 2는 항상 충분히 많기 때문입니다.

### D21. 진법 (Number Bases)

$$ \boxed{ (a_na_{n-1}\cdots a_0)_b =\sum_{i=0}^{n}a_i b^i } $$

여기서:

- $b$: 진법이며, $b\ge2$인 정수입니다.
- $a_i$: 각 자리의 숫자이며 $0\le a_i<b$를 만족합니다.

계산 방법: 가장 오른쪽 자리부터 각 숫자에 $b^0,b^1,b^2,\ldots$를 곱해 모두 더합니다.

10진수를 $b$진수로 바꾸려면 $b$로 계속 나누면서 나머지를 기록한 뒤, 그 나머지를 거꾸로 배열합니다.

### D22. 각 자리 숫자의 합 (Digit Sum)

10진 정수 $N$의 각 자리 숫자의 합을 $S$라 하면:

$$ \boxed{N\equiv S\pmod9} $$

$$ \boxed{N\equiv S\pmod3} $$

계산 방법: 각 자리 숫자를 모두 더한 뒤, 합을 3 또는 9로 나눈 나머지를 확인합니다.

### D23. 숫자의 자릿수 뒤집기 (Reversed Digits)

세 자리 수:

$$ \boxed{N=100a+10b+c} $$

자릿수를 뒤집으면:

$$ \boxed{R=100c+10b+a} $$

따라서:

$$ \boxed{N-R=99(a-c)} $$

계산 방법: 각 자리 숫자에 해당하는 자릿값을 곱해 원래 수와 뒤집은 수를 각각 식으로 쓴 다음 뺍니다.

### D24. 일차 정수 방정식 (Linear Diophantine Equations)

정수 $a,b,c$에 대해 $a,b$가 동시에 0은 아니라고 하자:

$$ \boxed{ax+by=c} $$

정수해가 존재하기 위한 필요충분조건:

$$ \boxed{\gcd(a,b)\mid c} $$

계산 방법: 먼저 GCD를 구해 $c$를 나누는지 확인합니다. 나누어떨어지면 나머지, 대입 또는 유클리드 알고리즘을 이용해 정수해를 찾습니다.

양의 정수해 또는 음이 아닌 정수해를 요구한다면 범위도 추가로 확인해야 합니다.

### D25. 배수의 개수 세기 (Counting Multiples)

$$ \boxed{ M(1,N;k)=\left\lfloor\frac Nk\right\rfloor } $$

$$ \boxed{ M(A,B;k)= \left\lfloor\frac Bk\right\rfloor- \left\lfloor\frac{A-1}{k}\right\rfloor } $$

여기서 $A,B,k$는 모두 양의 정수이고 $A\le B$입니다.

계산 방법: 구간의 상한까지의 배수 개수에서 하한보다 작은 범위의 배수 개수를 뺍니다.

## E. 조합론 (Combinatorics)

### E1. 덧셈 원리 (Addition Principle)

$$ \boxed{N=N_1+N_2+\cdots+N_k} $$

계산 방법: 서로 겹치지 않는 경우를 각각 센 뒤 더합니다.

경우가 겹치면 포함·배제 원리로 보정해야 합니다.

### E2. 곱셈 원리 (Multiplication Principle)

$$ \boxed{N=N_1N_2\cdots N_k} $$

계산 방법: 과정을 여러 단계로 나누고 각 단계의 선택 수를 구한 다음 곱합니다.

각 단계의 선택 수를 올바르게 세어야 합니다. 단계별 선택 수가 이전 선택에 따라 달라지면 경우를 더 나누어야 합니다.

### E3. 순열 (Permutations)

$$ \boxed{P(n,r)=\frac{n!}{(n-r)!}} $$

계산 방법: 서로 다른 $n$개 대상 중 $r$개를 고르며, 순서는 중요하고 중복 선택은 허용되지 않습니다.

직접 계산:

$$ \boxed{n(n-1)\cdots(n-r+1)} $$

인수는 총 $r$개입니다.

### E4. 조합 (Combinations)

$$ \boxed{\binom nr=\frac{n!}{r!(n-r)!}} $$

계산 방법: 서로 다른 $n$개 대상 중 $r$개를 고르며, 순서는 중요하지 않고 중복 선택은 허용되지 않습니다.

먼저 순열의 수를 구한 다음 $r!$로 나누어 같은 원소들의 순서만 다른 경우를 제거할 수 있습니다.

### E5. 중복 선택 (Selections with Repetition)

서로 다른 $n$종류에서 $r$번 선택할 때:

순서가 중요한 경우:

$$ \boxed{n^r} $$

순서가 중요하지 않은 경우:

$$ \boxed{\binom{n+r-1}{r}} $$

계산 방법:

- 순서가 중요하면 각 자리에 $n$가지 선택이 있습니다.
- 순서가 중요하지 않으면 별과 막대 기법으로 각 종류를 몇 개씩 선택하는지 셉니다.

### E6. 같은 원소가 포함된 순열 (Permutations of Identical Objects)

전체 $n$개 대상 중 같은 종류의 대상이 각각 $a_1,a_2,\ldots,a_k$개 있을 때:

$$ \boxed{ N=\frac{n!}{a_1!a_2!\cdots a_k!} } $$

조건:

$$ a_1+\cdots+a_k=n $$

계산 방법: 모든 대상이 서로 다르다고 가정한 순열의 수를 구한 뒤, 각 같은 대상 묶음 내부의 순열 수로 나눕니다.

### E7. 원순열 (Circular Permutations)

서로 다른 $n$개 대상을 원형으로 배열할 때 회전만 다른 배열은 같은 것으로 봅니다:

$$ \boxed{(n-1)!} $$

회전과 뒤집기를 모두 같은 배열로 보고 $n\ge3$일 때:

$$ \boxed{\frac{(n-1)!}{2}} $$

계산 방법: 한 대상을 고정해 회전으로 생기는 중복을 없앱니다. 뒤집기도 같은 것으로 보면 2로 나눕니다.

### E8. 별과 막대 (Stars and Bars)

음이 아닌 정수해의 개수:

$$ x_1+x_2+\cdots+x_k=n,\qquad x_i\ge0 $$

$$ \boxed{N=\binom{n+k-1}{k-1}} $$

양의 정수해의 개수:

$$ x_1+x_2+\cdots+x_k=n,\qquad x_i\ge1 $$

$$ \boxed{N=\binom{n-1}{k-1}} $$

계산 방법:

- 0을 허용할 때: 같은 물건 $n$개와 막대 $k-1$개를 배열합니다.
- 각 항이 1 이상일 때: 먼저 각 묶음에 물건 하나씩 주고, 0을 허용하는 공식을 적용합니다.

변수마다 최솟값 $L_i$가 다르면 먼저 $y_i=x_i-L_i$로 두고 음이 아닌 정수해 공식을 적용합니다.

### E9. 포함·배제 원리 (Inclusion–Exclusion Principle)

두 집합:

$$ \boxed{|A\cup B|=|A|+|B|-|A\cap B|} $$

세 집합:

$$ \boxed{ \begin{aligned} |A\cup B\cup C| ={}&|A|+|B|+|C|\\ &-|A\cap B|-|A\cap C|-|B\cap C|\\ &+|A\cap B\cap C| \end{aligned} } $$

계산 방법: 각 집합의 크기는 더하고, 두 집합의 교집합은 빼고, 세 집합의 교집합은 다시 더합니다. 집합이 더 많으면 더하기와 빼기를 번갈아 계속합니다.

### E10. 여집합을 이용한 세기 (Complementary Counting)

$$ \boxed{N_{\mathrm{wanted}}=N_{\mathrm{total}}-N_{\mathrm{unwanted}}} $$

계산 방법: 전체 경우의 수를 구한 다음 조건을 만족하지 않는 경우의 수를 뺍니다.

### E11. 블록 기법 (Block Method)

$k$개의 지정된 서로 다른 대상이 서로 붙어 있어야 하고, 전체 대상이 $n$개일 때:

$$ \boxed{N=(n-k+1)!\,k!} $$

계산 방법: 지정된 $k$개 대상을 하나의 블록으로 보고 나머지 $n-k+1$개 단위를 배열한 뒤, 블록 안의 $k!$가지 배열을 곱합니다.

이 공식은 다른 추가 제한이 없는 일렬 배열에만 적용됩니다.

### E12. 격자 경로 (Lattice Paths)

오른쪽으로 $m$걸음, 위쪽으로 $n$걸음만 이동할 때:

$$ \boxed{N=\binom{m+n}{m}} $$

계산 방법: 전체 $m+n$걸음 중 오른쪽으로 가는 $m$걸음의 위치를 고르면 나머지는 자동으로 위쪽 걸음입니다.

특정 점 P를 반드시 지나야 할 때:

$$ \boxed{N=N_{\mathrm{start}\to P}N_{P\to\mathrm{end}}} $$

특정 점 P를 지나면 안 될 때:

$$ \boxed{N_{\mathrm{allowed}}=N_{\mathrm{total}}-N_{\mathrm{through}\ P}} $$

도착점과 중간점이 이동 방향 조건을 만족해야 합니다.

### E13. 비둘기집 원리 (Pigeonhole Principle)

$N$개 대상을 $k$개 범주로 나누면:

$$ \boxed{ \text{某类别至少包含 } \left\lceil\frac Nk\right\rceil \text{ 个对象} } $$

계산 방법: 전체 대상 수를 범주 수로 나눈 뒤 올림합니다.

어떤 범주에 적어도 $r$개가 들어가도록 보장하려면:

$$ \boxed{N_{\min}=k(r-1)+1} $$

계산 방법: 각 범주에 최대 $r-1$개씩 먼저 넣은 다음 대상 하나를 더합니다.

### E14. 점화식 (Recurrence Relations)

$$ \boxed{a_n=f(a_{n-1},a_{n-2},\ldots)} $$

계산 방법: 크기가 $n$인 문제를 더 작은 문제들로 나눈 다음 초기 조건에 따라 차례로 계산합니다.

자주 쓰이는 피보나치 점화식:

$$ \boxed{F_n=F_{n-1}+F_{n-2}} $$

초기 항은 문제에서 정의한 방식에 따라 정해야 합니다.

### E15. 완전교란순열 (Derangements)

서로 다른 $n$개 대상을 배열할 때 어느 대상도 원래 자리에 오지 않아야 합니다:

$$ \boxed{ D_n=n!\sum_{k=0}^{n}\frac{(-1)^k}{k!} } $$

전개하면:

$$ \boxed{ D_n=n!\left(1-\frac1{1!}+\frac1{2!} -\frac1{3!}+\cdots+\frac{(-1)^n}{n!}\right) } $$

계산 방법: 먼저 전체 $n!$가지 배열을 구한 다음 포함·배제 원리로 고정된 자리가 있는 배열을 제외합니다.

점화식 형태:

$$ \boxed{D_n=(n-1)(D_{n-1}+D_{n-2})} $$

초기값:

$$ D_0=1,\qquad D_1=0 $$

### E16. 악수 정리 (Handshake Lemma)

무방향 그래프에서:

$$ \boxed{\sum_{v\in V}\deg(v)=2E} $$

여기서:

- $\deg(v)$: 꼭짓점 $v$의 차수, 즉 그 꼭짓점에 연결된 변의 수입니다.
- $E$: 변의 총개수입니다.

계산 방법: 각 꼭짓점에 연결된 변의 수를 모두 더한 뒤 2로 나누면 변의 개수가 됩니다.

$n$개 대상이 중복 없이 서로 모두 연결되어 있다면:

$$ \boxed{E=\binom n2=\frac{n(n-1)}2} $$

### E17. 직선의 교점 (Line Intersections)

서로 다른 $n$개 직선 중 어느 두 직선도 평행하지 않고, 어느 세 직선도 한 점에서 만나지 않을 때:

$$ \boxed{I=\binom n2} $$

계산 방법: 모든 직선 중 두 개를 선택하면 각 쌍이 서로 다른 교점 하나를 만듭니다.

### E18. 원 안의 현의 교점 (Circle Chord Intersections)

원 위에 서로 다른 $n$개 점이 있고, 임의의 두 점을 연결하되 세 현이 원 안의 같은 점에서 만나지 않을 때:

$$ \boxed{I=\binom n4} $$

계산 방법: 원 위의 네 점마다 원 안에서 교차하는 두 현 한 쌍이 정해지므로 $n$개 점 중 네 개를 선택합니다.

## F. 확률과 통계 (Probability & Statistics)

### F1. 고전적 확률 (Classical Probability)

모든 기본 결과가 같은 확률로 발생할 때:

$$ \boxed{P(A)=\frac{N(A)}{N(S)}} $$

여기서:

- $N(A)$: 사건 A에 해당하는 결과의 개수입니다.
- $N(S)$: 가능한 모든 기본 결과의 개수입니다.

계산 방법: 조건을 만족하는 결과의 수를 센 뒤 전체 결과 수로 나눕니다.

### F2. 여사건의 확률 (Complement Rule)

$$ \boxed{P(A^c)=1-P(A)} $$

계산 방법: 반대 사건이 발생할 확률을 1에서 뺍니다.

### F3. 확률의 덧셈 법칙 (Addition Rule)

$$ \boxed{P(A\cup B)=P(A)+P(B)-P(A\cap B)} $$

A와 B가 서로 배반이면:

$$ \boxed{P(A\cup B)=P(A)+P(B)} $$

계산 방법: 두 사건의 확률을 더한 뒤 중복해서 센 교집합의 확률을 뺍니다.

### F4. 확률의 곱셈 법칙 (Multiplication Rule)

$$ \boxed{P(A\cap B)=P(A)P(B\mid A)} $$

A와 B가 독립이면:

$$ \boxed{P(A\cap B)=P(A)P(B)} $$

계산 방법: 첫 번째 사건의 확률에, 첫 번째 사건이 일어난 뒤 두 번째 사건이 일어날 조건부확률을 곱합니다.

독립이면 첫 번째 사건이 두 번째 사건의 확률에 영향을 주지 않습니다.

### F5. 조건부확률 (Conditional Probability)

$$ \boxed{P(A\mid B)=\frac{P(A\cap B)}{P(B)}} $$

조건은 $P(B)>0$입니다.

계산 방법: B가 일어났다고 알고 있을 때 B에 해당하는 경우만 살펴보고, 그중 A도 만족하는 비율을 계산합니다.

### F6. 이항확률 (Binomial Probability)

$$ \boxed{ P(X=k)=\binom nk p^k(1-p)^{n-k} } $$

여기서:

- $n$: 서로 독립인 시행의 횟수입니다.
- $k$: 구하려는 성공 횟수입니다.
- $p$: 한 번 시행에서 성공할 확률입니다.
- $X$: 전체 성공 횟수입니다.

계산 방법:

1. 성공이 $k$번 일어날 위치를 선택하는 방법의 수를 계산합니다.
2. 성공 $k$번의 확률을 곱합니다.
3. 나머지 $n-k$번이 실패할 확률도 곱합니다.

각 시행은 서로 독립이어야 하며 성공 확률이 같아야 합니다.

### F7. 초기하분포 확률 (Hypergeometric Probability)

서로 다른 $N$개 대상 중 $n$개를 비복원 추출하고, 그중 목표 대상이 $K$개일 때 정확히 $k$개의 목표 대상을 뽑을 확률:

$$ \boxed{ P(X=k)= \frac{\binom Kk\binom{N-K}{n-k}}{\binom Nn} } $$

계산 방법: 목표 대상과 나머지 대상에서 필요한 수만큼 선택하는 두 조합의 수를 곱한 뒤 전체 선택 방법의 수로 나눕니다.

### F8. 기댓값 (Expected Value)

$$ \boxed{E(X)=\sum_i x_iP(X=x_i)} $$

계산 방법: 가능한 각 결과에 해당 확률을 곱한 뒤 모두 더합니다.

기댓값의 선형성:

$$ \boxed{E(X+Y)=E(X)+E(Y)} $$

두 확률변수가 독립이 아니어도 성립합니다.

### F9. 기하확률 (Geometric Probability)

균등 무작위 선택일 때:

$$ \boxed{ P(A)=\frac{\text{Favourable Area}}{\text{Total Area}} } $$

무작위 점이 선분 위에 균등하게 분포할 때:

$$ \boxed{ P(A)=\frac{\text{Favourable Length}}{\text{Total Length}} } $$

계산 방법: 무작위로 선택되는 기본 대상이 넓이, 길이 또는 다른 측도 중 무엇인지 확인한 뒤 유리한 부분과 전체의 비율을 계산합니다.

### F10. 평균, 중앙값, 최빈값과 범위 (Mean, Median, Mode & Range)

평균:

$$ \boxed{\bar x=\frac{\sum x_i}{n}} $$

범위:

$$ \boxed{R=x_{\max}-x_{\min}} $$

계산 방법:

- Mean: 자료를 모두 더한 뒤 개수로 나눕니다.
- Median: 자료를 정렬한 뒤 가운데 값을 취합니다. 자료 개수가 짝수이면 가운데 두 값의 평균을 취합니다.
- Mode: 가장 자주 나타나는 자료를 찾습니다.
- Range: 최댓값에서 최솟값을 뺍니다.

## G. 평면기하 (Plane Geometry)

### G1. 기본 각도 법칙 (Basic Angle Rules)

평각:

$$ \boxed{180^\circ} $$

한 바퀴의 각:

$$ \boxed{360^\circ} $$

맞꼭지각:

$$ \boxed{\angle1=\angle2} $$

계산 방법: 직선, 교차하는 직선 및 평행선의 각도 관계를 이용해 각이 같거나 보각을 이루는 방정식을 세웁니다.

평행선이 횡단선과 만날 때:

- Corresponding Angles(동위각)는 같습니다.
- Alternate Interior Angles(엇각)는 같습니다.
- Co-interior Angles(같은 쪽 내각)의 합은 $180^\circ$입니다.

### G2. 삼각형의 내각의 합 (Triangle Angle Sum)

$$ \boxed{A+B+C=180^\circ} $$

외각 정리:

$$ \boxed{\text{Exterior Angle}=A+B} $$

여기서 A와 B는 해당 외각과 이웃하지 않는 두 내각입니다.

계산 방법: 내각 두 개를 알면 180°에서 그 합을 뺍니다. 반대쪽 두 내각을 알면 더해서 해당 외각을 구합니다.

### G3. 이등변삼각형과 정삼각형 (Isosceles & Equilateral Triangles)

이등변삼각형에서 두 변이 같으면 그에 대응하는 밑각도 같습니다.

정삼각형:

$$ \boxed{A=B=C=60^\circ} $$

변의 길이가 $a$일 때 높이:

$$ \boxed{h=\frac{\sqrt3}{2}a} $$

넓이:

$$ \boxed{S=\frac{\sqrt3}{4}a^2} $$

계산 방법: 정삼각형의 높이로 두 개의 30°–60°–90° 직각삼각형을 만들고, 변의 비를 이용해 높이와 넓이를 구합니다.

### G4. 삼각형 부등식 (Triangle Inequality)

$$ \boxed{|a-b|<c<a+b} $$

여기서 $a,b,c>0$입니다.

계산 방법: 두 변이 주어지면 세 번째 변은 두 변의 차의 절댓값보다 크고 두 변의 합보다 작아야 합니다.

세 번째 변이 정수로 제한되면 이 열린 구간에 포함되는 정수만 세면 됩니다.

### G5. 피타고라스 정리 (Pythagorean Theorem)

직각삼각형에서:

$$ \boxed{a^2+b^2=c^2} $$

여기서 $c$는 빗변입니다.

계산 방법: 두 변을 알면 제곱의 합 또는 차를 이용해 나머지 한 변을 구합니다.

자주 나오는 정수 변의 조합:

| 직각변   | 빗변 |
| ----- | -- |
| 3、4   | 5  |
| 5、12  | 13 |
| 8、15  | 17 |
| 7、24  | 25 |
| 9、40  | 41 |
| 20、21 | 29 |

이 비의 정수배도 피타고라스 정리를 만족합니다.

### G6. 특수한 직각삼각형 (Special Right Triangles)

45°–45°–90°

$$ \boxed{1:1:\sqrt2} $$

30°–60°–90°

$$ \boxed{1:\sqrt3:2} $$

계산 방법: 삼각형의 각도로 해당하는 세 변의 비를 알아낸 뒤, 주어진 변의 길이를 비의 단위로 삼아 나머지 변을 구합니다.

### G7. 삼각형의 넓이 (Triangle Area)

$$ \boxed{S=\frac12 bh} $$

여기서:

- $b$: 밑변입니다.
- $h$: 해당 밑변에 수직인 높이입니다.

계산 방법: 밑변에 높이를 곱한 뒤 2로 나눕니다.

높이가 같은 삼각형:

$$ \boxed{\frac{S_1}{S_2}=\frac{b_1}{b_2}} $$

밑변이 같은 삼각형:

$$ \boxed{\frac{S_1}{S_2}=\frac{h_1}{h_2}} $$

### G8. 헤론 공식 (Heron's Formula)

$$ \boxed{s=\frac{a+b+c}{2}} $$

$$ \boxed{S=\sqrt{s(s-a)(s-b)(s-c)}} $$

여기서 $s$는 반둘레입니다.

계산 방법: 세 변의 길이가 주어지면 먼저 반둘레를 구하고, 네 인수의 곱을 계산한 뒤 제곱근을 취합니다.

### G9. 닮은 삼각형 (Similar Triangles)

두 삼각형이 닮음이고 대응하는 변의 길이 비가 $k$라면:

$$ \boxed{\frac{a_1}{a_2}=k} $$

$$ \boxed{\frac{S_1}{S_2}=k^2} $$

계산 방법: 대응하는 변의 비로 다른 변을 구합니다. 넓이의 비를 구할 때는 변의 비를 제곱합니다.

닮음 판정:

- AA: 대응하는 두 각이 같습니다.
- SAS: 대응하는 두 쌍의 변의 비가 같고 그 끼인각이 같습니다.
- SSS: 대응하는 세 쌍의 변의 비가 같습니다.

### G10. 합동인 삼각형 (Congruent Triangles)

자주 쓰이는 합동 조건은 SSS, SAS, ASA, AAS, RHS/HL입니다.

계산 방법: 대응변과 대응각이 같은지 확인해 합동인지 판단합니다. 합동이면 모든 대응변, 대응각과 넓이가 같습니다.

### G11. 각의 이등분선 정리 (Angle Bisector Theorem)

삼각형 $ABC$에서 $AD$가 $\angle A$를 이등분하고 $D$가 $BC$ 위에 있을 때:

$$ \boxed{\frac{BD}{DC}=\frac{AB}{AC}} $$

계산 방법: 인접한 두 변의 비를 이용해 각의 이등분선이 대변을 나눈 두 부분의 길이 비를 구한 뒤, $BD+DC=BC$와 결합해 길이를 계산합니다.

### G12. 중선과 무게중심 (Median & Centroid)

$AD$가 삼각형의 중선이고 $G$가 무게중심이면:

$$ \boxed{AG:GD=2:1} $$

따라서:

$$ \boxed{AG=\frac23AD} \qquad \boxed{GD=\frac13AD} $$

계산 방법: 중선의 길이를 3등분하면 꼭짓점에서 무게중심까지는 2부분, 무게중심에서 대변의 중점까지는 1부분입니다.

중선은 삼각형의 넓이를 반으로 나눕니다:

$$ \boxed{S_1=S_2} $$

### G13. 내심과 내접원 (Incenter & Inradius)

$$ \boxed{S=rs} $$

여기서:

- $r$: 내접원의 반지름입니다.
- $s$: 삼각형의 반둘레입니다.
- $S$: 삼각형의 넓이입니다.

계산 방법: 넓이를 반둘레로 나누어 내접원의 반지름을 구하거나, 반지름과 반둘레를 곱해 넓이를 구합니다.

### G14. 외심과 외접원 (Circumcenter & Circumradius)

$$ \boxed{S=\frac{abc}{4R}} $$

따라서:

$$ \boxed{R=\frac{abc}{4S}} $$

여기서:

- $a,b,c$: 세 변의 길이입니다.
- $R$: 외접원의 반지름입니다.
- $S$: 넓이입니다.

계산 방법: 세 변과 넓이를 알면 세 변의 곱을 구해 넓이의 네 배로 나눕니다.

직각삼각형에서는:

$$ \boxed{R=\frac c2} $$

여기서 $c$는 빗변입니다.

### G15. 직각삼각형의 빗변에 내린 높이 (Right Triangle Altitude Theorem)

빗변이 $c$이고 높이 $h$가 이를 $m,n$으로 나눈다면:

$$ \boxed{c=m+n} $$

$$ \boxed{h^2=mn} $$

두 직각변 $a,b$의 정사영이 각각 $m,n$일 때:

$$ \boxed{a^2=cm} $$

$$ \boxed{b^2=cn} $$

계산 방법: 닮은 삼각형의 대응변 비를 이용해 제곱 관계를 세우고 높이나 직각변의 길이를 구합니다.

### G16. 사각형 (Quadrilaterals)

| 도형                  | 공식                    | 계산 방법             |
| ------------------- | --------------------- | ---------------- |
| Rectangle 직사각형       | $S=lw$            | 가로와 세로를 곱함              |
| Rectangle Perimeter | $P=2(l+w)$        | 가로와 세로의 합에 2를 곱함          |
| Square 정사각형          | $S=a^2$           | 한 변의 길이를 제곱함             |
| Square Diagonal     | $d=a\sqrt2$       | 한 변의 길이에 $\sqrt2$를 곱함 |
| Parallelogram 평행사변형 | $S=bh$            | 밑변과 수직 높이를 곱함            |
| Trapezoid 사다리꼴        | $S=\frac12(a+b)h$ | 두 밑변의 합에 높이를 곱한 뒤 2로 나눔     |
| Rhombus 마름모          | $S=\frac12d_1d_2$ | 두 대각선의 곱을 2로 나눔      |

여기서 $l,w$는 가로와 세로이고, $b,h$는 밑변과 수직 높이이며, $d_i$는 대각선의 길이입니다.

### G17. 다각형의 각 (Polygon Angle Sum)

$n$각형의 내각의 합:

$$ \boxed{(n-2)180^\circ} $$

정$n$각형의 각 내각:

$$ \boxed{\frac{(n-2)180^\circ}{n}} $$

정$n$각형의 각 외각:

$$ \boxed{\frac{360^\circ}{n}} $$

계산 방법: 변의 수 $n$을 해당 공식에 대입합니다. 볼록다각형의 각 꼭짓점에서 같은 방향으로 하나씩 택한 외각의 합은 $360^\circ$입니다.

### G18. 다각형의 대각선 (Polygon Diagonals)

$$ \boxed{D=\frac{n(n-3)}2} $$

계산 방법: 각 꼭짓점에서 대각선을 그을 수 있는 비인접 꼭짓점은 $n-3$개입니다. 이를 꼭짓점 수 $n$과 곱한 뒤 중복 계산을 없애기 위해 2로 나눕니다.

### G19. 정다각형의 넓이 (Regular Polygon Area)

$$ \boxed{S=\frac12Pa} $$

여기서:

- $P$: 둘레입니다.
- $a$: Apothem, 중심에서 한 변까지의 수직 거리인 아포템입니다.

계산 방법: 둘레와 아포템의 곱을 2로 나눕니다.

한 변의 길이가 $s$인 정육각형:

$$ \boxed{S=\frac{3\sqrt3}{2}s^2} $$

### G20. 원 (Circle)

둘레:

$$ \boxed{C=2\pi r} $$

넓이:

$$ \boxed{S=\pi r^2} $$

지름:

$$ \boxed{d=2r} $$

계산 방법: 반지름을 이용해 바로 계산합니다.

### G21. 호의 길이 (Arc Length)

중심각이 $\theta^\circ$일 때:

$$ \boxed{L=\frac{\theta}{360^\circ}2\pi r} $$

계산 방법: 중심각을 360°로 나누어 호가 전체 원에서 차지하는 비율을 구한 뒤, 원의 둘레를 곱합니다.

### G22. 부채꼴의 넓이 (Sector Area)

$$ \boxed{S_{\mathrm{sector}}=\frac{\theta}{360^\circ}\pi r^2} $$

계산 방법: 중심각이 360°에서 차지하는 비율에 원 전체의 넓이를 곱합니다.

활꼴의 넓이:

$$ \boxed{S_{\mathrm{segment}}=S_{\mathrm{sector}}-S_{\mathrm{triangle}}} $$

환의 넓이:

$$ \boxed{S_{\mathrm{annulus}}=\pi(R^2-r^2)} $$

### G23. 원주각 정리 (Inscribed Angle Theorem)

같은 호에 대해:

$$ \boxed{\theta_{\mathrm{inscribed}}=\frac12\theta_{\mathrm{central}}} $$

계산 방법: 중심각을 2로 나누면 같은 호에 대한 원주각을 구할 수 있습니다.

반원에 대한 원주각:

$$ \boxed{90^\circ} $$

### G24. 원에 내접하는 사각형 (Cyclic Quadrilaterals)

원에 내접하는 사각형 $ABCD$에 대해:

$$ \boxed{A+C=180^\circ} $$

$$ \boxed{B+D=180^\circ} $$

계산 방법: 한 내각을 알면 $180^\circ$에서 그 값을 빼 반대편 각을 구합니다.

### G25. 접선 (Tangents)

접점에서 반지름과 접선은 서로 수직입니다:

$$ \boxed{OT\perp PT} $$

같은 원 밖의 점 P에서 두 접선 PA, PB를 그으면:

$$ \boxed{PA=PB} $$

계산 방법: 수직 관계로 직각삼각형을 세우거나, 같은 점에서 그은 접선의 길이가 같다는 성질을 이용합니다.

### G26. 현의 길이 (Chord Length)

반지름이 $r$이고 원의 중심에서 현까지의 수직 거리가 $d$일 때:

$$ \boxed{L=2\sqrt{r^2-d^2}} $$

계산 방법: 현을 두 부분으로 이등분한 뒤 피타고라스 정리로 반쪽 길이를 구해 2를 곱합니다.

### G27. 교차하는 현의 정리 (Intersecting Chords Theorem)

원 안에서 두 현 $AB,CD$가 P에서 만날 때:

$$ \boxed{PA\cdot PB=PC\cdot PD} $$

계산 방법: 교점 양쪽에 있는 현의 길이를 각각 곱한 뒤 두 곱이 같다고 둡니다.

### G28. 점의 거듭제곱 (Power of a Point)

두 할선이 원 밖의 같은 점 P에서 시작할 때:

$$ \boxed{PA\cdot PB=PC\cdot PD} $$

A,C는 각 할선과 원이 만나는 가까운 점이고, B,D는 먼 점입니다.

접선 PT와 할선 PAB에 대해:

$$ \boxed{PT^2=PA\cdot PB} $$

계산 방법: 원 밖에 있는 부분의 길이에 P에서 먼 교점까지의 전체 길이를 곱합니다. 접선이면 접선 길이를 제곱합니다.

### G29. 원에서의 교차각 (Circle Intersection Angles)

두 현이 원 안에서 만날 때:

$$ \boxed{\theta=\frac{\alpha+\beta}{2}} $$

두 할선이 원 밖에서 만날 때:

$$ \boxed{\theta=\frac{\alpha-\beta}{2}} $$

$\alpha,\beta$는 해당 절단호의 각도이며, 두 번째 공식에서는 먼 쪽 호에서 가까운 쪽 호를 뺍니다.

계산 방법: 교점이 원 안인지 밖인지에 따라 호의 각도를 더하거나 빼고 2로 나눕니다.

## H. 좌표기하 (Coordinate Geometry)

### H1. 두 점 사이의 거리 (Distance Formula)

$$ \boxed{ d=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2} } $$

계산 방법: x좌표 차의 제곱과 y좌표 차의 제곱을 더한 뒤 제곱근을 취합니다.

### H2. 중점 (Midpoint Formula)

$$ \boxed{ M=\left(\frac{x_1+x_2}{2},\frac{y_1+y_2}{2}\right) } $$

계산 방법: 두 x좌표의 평균을 구하고 두 y좌표의 평균을 구합니다.

### H3. 기울기 (Slope)

$$ \boxed{m=\frac{y_2-y_1}{x_2-x_1}} $$

조건은 $x_1\ne x_2$입니다.

계산 방법: y좌표의 변화량을 x좌표의 변화량으로 나눕니다.

### H4. 직선의 방정식 (Equations of Lines)

기울기-절편형:

$$ \boxed{y=mx+c} $$

점-기울기형:

$$ \boxed{y-y_1=m(x-x_1)} $$

평행 조건 (수직선이 아닌 직선):

$$ \boxed{m_1=m_2} $$

수직 조건 (두 기울기가 모두 정의될 때):

$$ \boxed{m_1m_2=-1} $$

계산 방법: 한 점과 기울기를 알면 점-기울기형을 사용합니다. 두 점을 알면 먼저 기울기를 계산한 뒤 두 점 중 하나를 대입합니다.

### H5. 좌표로 구하는 삼각형의 넓이 (Triangle Area from Coordinates)

$$ \boxed{ S=\frac12\left| x_1(y_2-y_3)+x_2(y_3-y_1)+x_3(y_1-y_2) \right| } $$

계산 방법: 공식에 따라 교차 곱을 계산해 더한 뒤, 절댓값을 취하고 2로 나눕니다.

### H6. 신발끈 공식 (Shoelace Formula)

다각형의 꼭짓점이 경계 순서로 나열되어 있을 때:

$$ (x_1,y_1),\ldots,(x_n,y_n) $$

다음과 같이 둡니다:

$$ x_{n+1}=x_1,\qquad y_{n+1}=y_1 $$

넓이:

$$ \boxed{ S=\frac12\left| \sum_{i=1}^n x_i y_{i+1} - \sum_{i=1}^n y_i x_{i+1} \right| } $$

계산 방법: 한 방향의 교차 곱을 더하고 반대 방향의 교차 곱을 더한 다음 두 합을 빼고, 절댓값을 취해 2로 나눕니다.

### H7. 픽의 정리 (Pick's Theorem)

꼭짓점이 정수 격자점에 놓인 단순 다각형에 적용됩니다:

$$ \boxed{S=I+\frac B2-1} $$

여기서:

- $I$: 다각형의 내부에 엄격히 놓인 격자점의 개수입니다.
- $B$: 다각형의 경계에 놓인 격자점의 개수입니다.

계산 방법: 내부 격자점 수에 경계 격자점 수의 절반을 더하고 1을 뺍니다.

### H8. 좌표 변환 (Coordinate Transformations)

| 변환             | 새 좌표             |
| -------------- | --------------- |
| x축에 대한 대칭       | $(x,-y)$    |
| y축에 대한 대칭       | $(-x,y)$    |
| 원점에 대한 대칭         | $(-x,-y)$   |
| 반시계 방향 90° 회전      | $(-y,x)$    |
| 시계 방향 90° 회전      | $(y,-x)$    |
| 180° 회전        | $(-x,-y)$   |
| $(a,b)$만큼 평행이동 | $(x+a,y+b)$ |

모든 회전은 원점을 중심으로 합니다.

## I. 입체기하 (Solid Geometry)

### I1. 정육면체 (Cube)

한 변의 길이가 $a$일 때:

$$ \boxed{V=a^3} $$

$$ \boxed{S=6a^2} $$

공간 대각선:

$$ \boxed{d=a\sqrt3} $$

계산 방법: 한 변의 세제곱으로 부피를 구하고, 같은 정사각형 6개의 넓이를 더해 겉넓이를 구합니다. 공간 대각선에는 3차원 피타고라스 관계를 사용합니다.

### I2. 직육면체 (Rectangular Prism)

$$ \boxed{V=lwh} $$

$$ \boxed{S=2(lw+lh+wh)} $$

$$ \boxed{d=\sqrt{l^2+w^2+h^2}} $$

여기서 $l,w,h$는 각각 길이, 너비, 높이입니다.

### I3. 원기둥 (Cylinder)

$$ \boxed{V=\pi r^2h} $$

$$ \boxed{S=2\pi r^2+2\pi rh} $$

계산 방법: 밑면의 넓이에 높이를 곱하면 부피입니다. 원형 밑면 두 개의 넓이와 옆면의 넓이를 더하면 전체 겉넓이입니다.

### I4. 원뿔 (Cone)

$$ \boxed{V=\frac13\pi r^2h} $$

옆넓이:

$$ \boxed{S_{\mathrm{lateral}}=\pi rl} $$

직원뿔에서:

$$ \boxed{l=\sqrt{r^2+h^2}} $$

여기서 $l$은 모선의 길이입니다.

전체 겉넓이:

$$ \boxed{S=\pi r^2+\pi rl} $$

### I5. 구 (Sphere)

$$ \boxed{V=\frac43\pi r^3} $$

$$ \boxed{S=4\pi r^2} $$

계산 방법: 반지름의 세제곱에 $4\pi/3$을 곱해 부피를 구하고, 반지름의 제곱에 $4\pi$를 곱해 겉넓이를 구합니다.

### I6. 각기둥과 각뿔 (Prism & Pyramid)

각기둥:

$$ \boxed{V=S_{\mathrm{base}}h} $$

각뿔:

$$ \boxed{V=\frac13S_{\mathrm{base}}h} $$

계산 방법: 밑면의 넓이에 수직 높이를 곱합니다. 각뿔이면 다시 3으로 나눕니다.

### I7. 닮은 입체도형 (Similar Solids)

대응하는 길이의 비가 $k$일 때:

$$ \boxed{\frac{S_1}{S_2}=k^2} $$

$$ \boxed{\frac{V_1}{V_2}=k^3} $$

계산 방법: 넓이의 비는 길이 비의 제곱이고 부피의 비는 길이 비의 세제곱입니다.

### I8. 오일러 다면체 공식 (Euler's Polyhedron Formula)

볼록다면체에서:

$$ \boxed{V-E+F=2} $$

여기서:

- $V$: 꼭짓점의 개수입니다.
- $E$: 모서리의 개수입니다.
- $F$: 면의 개수입니다.

계산 방법: 알려진 두 값을 공식에 대입해 나머지 값을 구합니다.

## J. 기타 수학 기법 (Other Mathematical Techniques)

### J1. 홀짝성 (Parity)

짝수:

$$ \boxed{2k} $$

홀수:

$$ \boxed{2k+1} $$

여기서 $k\in\mathbb Z$입니다.

계산 방법: 정수의 홀짝 표현을 이용해 계산 결과를 $2m$ 또는 $2m+1$ 형태로 정리하고 홀수인지 짝수인지 판단합니다.

### J2. 불변량 (Invariants)

한 수가 매번 $km$만큼 변하는 연산이라면:

$$ \boxed{N_{\mathrm{new}}\equiv N_{\mathrm{old}}\pmod m} $$

계산 방법: 매 연산에서 변하지 않는 나머지, 홀짝성, 색별 개수의 차 또는 다른 양을 찾아 특정 결과가 가능한지 판단합니다.

### J3. 상한과 하한 (Bounds)

$$ \boxed{L\le x\le U} $$

여기서 $L$은 하한이고 $U$는 상한입니다.

계산 방법: 비음수성, 대소 비교, 단조성 또는 부등식으로 범위를 세운 뒤 선택지나 정수 조건과 비교합니다.

### J4. 대칭식 (Symmetric Expressions)

다음과 같이 알고 있다면:

$$ s=a+b,\qquad p=ab $$

그러면:

$$ \boxed{a^2+b^2=s^2-2p} $$

$$ \boxed{a^3+b^3=s^3-3ps} $$

$$ \boxed{(a-b)^2=s^2-4p} $$

계산 방법: 두 수 $a,b$를 먼저 구하지 않고 합과 곱으로 고차 대수식을 나타냅니다.

### J5. 시계의 각도 (Clock Angles)

12시간제를 사용하고 $h\in\{0,1,\ldots,11\}$로 두며 $m$은 분의 수라고 합시다:

시침의 각도:

$$ \boxed{\theta_h=30h+0.5m} $$

분침의 각도:

$$ \boxed{\theta_m=6m} $$

두 바늘의 각도 차:

$$ \boxed{\Delta=|30h-5.5m|} $$

작은 쪽의 끼인각:

$$ \boxed{\theta=\min(\Delta,360^\circ-\Delta)} $$

계산 방법: 두 바늘이 12시 방향과 이루는 각을 각각 계산하고 차를 구한 다음, 더 작은 끼인각을 취합니다.

### J6. 이중 계산 (Double Counting)

핵심 관계:

$$ \boxed{\text{Count by Method A}=\text{Count by Method B}} $$

계산 방법: 같은 대상이나 관계를 두 가지 관점에서 세어 등식을 세우고 미지수를 구합니다.

자주 쓰이는 형태:

$$ \boxed{\sum\deg(v)=2E} $$

### J7. 여러 비음수에 대한 산술·기하평균 부등식 (AM–GM for Multiple Numbers)

비음수 실수 $x_1,\ldots,x_n$에 대해:

$$ \boxed{ \frac{x_1+\cdots+x_n}{n} \ge\sqrt[n]{x_1x_2\cdots x_n} } $$

계산 방법: 비음수 변수들의 합이 고정되어 있으면 이 부등식으로 곱의 상한을 구할 수 있습니다. 양의 곱이 고정되어 있으면 합의 하한을 구할 수 있습니다.

등호는 모든 변수가 서로 같을 때 성립합니다.

# 제2부: 사용할 공식 판단하기

이 부분에서는 문제에 나온 영어 키워드, 주어진 조건과 구하려는 값에 따라 공식을 분류합니다.

같은 키워드가 여러 공식과 연결될 수 있으므로 문제의 실제 제한 조건을 함께 살펴야 합니다.

## 1. 산술과 대수 (Arithmetic & Algebra)

| 문제 조건 / English Keywords             | 판단 방법        | 사용 공식                            |
| ----------------------------------- | ----------- | ------------------------------- |
| percentage increase / decrease      | 비율에 따라 증가 또는 감소    | $N=O(1+r)$                  |
| average / mean                      | 합계와 개수가 주어짐     | $\bar x=\frac{\sum x_i}{n}$ |
| combined average                    | 집단마다 자료 수가 다름    | Weighted Average                |
| average speed                       | 전체 거리와 전체 시간     | $v=\frac dt$                |
| same distance, different speeds     | 같은 거리를 왕복함       | $\frac{2ab}{a+b}$           |
| working together                    | 여러 사람이 함께 작업함    | $\frac1T=\frac1a+\frac1b$   |
| concentration / mixture             | 서로 다른 농도의 용액을 혼합함      | 용질 전체 질량을 혼합물 전체 질량으로 나눔                     |
| constant difference                 | 연속된 항의 차가 일정함      | Arithmetic Sequence             |
| constant ratio                      | 연속된 항의 비가 일정함      | Geometric Sequence              |
| sum of consecutive integers         | 연속된 정수의 합      | $\frac{n(n+1)}2$            |
| sum of squares                      | 연속된 정수 제곱의 합    | $\frac{n(n+1)(2n+1)}6$      |
| sum of cubes                        | 연속된 정수 세제곱의 합    | $[\frac{n(n+1)}2]^2$        |
| fractional terms cancel             | 인접한 분수 항이 소거됨   | Telescoping Sum                 |
| roots of a quadratic                | 근을 구해야 함        | Quadratic Formula               |
| sum/product of roots                | 근의 합 또는 곱만 필요함    | Vieta's Formulas                |
| maximum / minimum of a quadratic    | 이차함수의 극값      | Completing the Square           |
| fixed sum, maximum product          | 음이 아닌 변수들의 합이 고정됨    | AM–GM                           |
| fixed positive product, minimum sum | 양수 변수들의 곱이 고정됨     | AM–GM                           |
| distance from a number              | 수직선 위의 거리      | Absolute Value                  |
| coefficient of a term               | 이항식 전개에서 특정 항의 계수 | Binomial Theorem                |
| exponential growth                  | 주기마다 일정한 비율로 증가함   | Compound Growth                 |

## 2. 정수론 (Number Theory)

| 문제 조건 / English Keywords               | 판단 방법          | 사용 공식                                |
| ------------------------------------- | ------------- | ----------------------------------- |
| prime number                          | 소수 판별          | $\sqrt N$ 이하의 소수로 나누어 봄             |
| prime factorisation                   | 소인수분해         | $N=\prod p_i^{a_i}$             |
| number of positive divisors / factors | 양의 약수의 개수         | $\prod(a_i+1)$                  |
| sum of all factors                    | 양의 약수의 합         | $\prod(1+p_i+\cdots+p_i^{a_i})$ |
| product of all factors                | 양의 약수의 곱         | $N^{d(N)/2}$                    |
| greatest common divisor               | 최대공약수         | GCD / Euclidean Algorithm           |
| least common multiple                 | 최소공배수         | LCM                                 |
| relatively prime / coprime            | 두 수가 서로소임          | $\gcd(a,b)=1$                   |
| how many numbers are coprime to n     | 1부터 n까지 중 서로소인 수의 개수 | Euler's Totient Function            |
| remainder when divided by             | 나머지 구하기           | Modular Arithmetic                  |
| last digit                            | 일의 자리 숫자 구하기           | Modulo 10                           |
| last two digits                       | 끝의 두 자리 구하기          | Modulo 100                          |
| large integer powers                  | 큰 거듭제곱의 나머지 구하기        | Powers Cycle / Fermat / Euler       |
| trailing zeros of n!                  | 계승의 끝자리 0 개수         | Legendre's Formula                  |
| perfect square                        | 완전제곱수 판별        | 모든 소인수의 지수가 짝수임                          |
| perfect cube                          | 완전세제곱수 판별        | 모든 소인수의 지수가 3의 배수임                      |
| number of square divisors             | 완전제곱수인 약수의 개수      | $\prod(\lfloor a_i/2\rfloor+1)$ |
| integer solutions                     | 정수 방정식          | GCD / Modular Arithmetic            |
| multiples between A and B             | 구간 안 배수의 개수        | Floor Function                      |
| binary / base-n                       | 진법 문제          | Positional Number Formula           |
| sum of digits                         | 각 자리 숫자의 합과 나눗셈 판정        | Modulo 3 / 9                        |
| reversed digits                       | 뒤집은 숫자          | 자릿값 전개                                |

## 3. 조합론 (Counting)

먼저 순서가 중요한지 판단하고, 이어서 중복 선택이 허용되는지 확인합니다:

| 순서 중요 | 중복 허용 | 공식 | 적용 조건 |
| --- | --- | --- | --- |
| 예 | 아니요 | $P(n,r)=\frac{n!}{(n-r)!}$ | 서로 다른 $n$개 대상 중 $r$개를 순서를 고려해 중복 없이 선택 |
| 예 | 예 | $n^r$ | 매번 $n$가지 중 선택하고 총 $r$회 고릅니다. 순서가 중요하고 중복이 허용됩니다. |
| 아니요 | 아니요 | $\binom nr$ | 서로 다른 $n$개 대상 중 $r$개를 순서 없이 중복 없이 선택 |
| 아니요 | 예 | $\binom{n+r-1}{r}$ | $n$종류의 대상 중 $r$개를 순서 없이 중복을 허용해 선택 |

이 판단표는 인접 조건, 위치 제한, 수량의 상한·하한 등 추가 제약이 없는 기본 선택 문제에 적용됩니다.

그 밖의 계수 문제:

| English Keywords / 조건          | 판단 방법        | 사용 공식                             |
| ------------------------------ | ----------- | -------------------------------- |
| identical objects              | 서로 구별할 수 없는 같은 대상이 있음 | Repeated Permutations            |
| around a round table           | 원형 배열이며 회전한 배열은 같게 봄   | $(n-1)!$                     |
| necklace, flipping allowed     | 목걸이처럼 뒤집은 배열도 같게 봄     | $(n-1)!/2$;모든 대상이 서로 다른 등의 조건이 필요함      |
| distribute identical items     | 같은 물건을 서로 다른 그룹에 나눔   | Stars and Bars                   |
| nonnegative integer solutions  | 음이 아닌 정수로 분배함      | $\binom{n+k-1}{k-1}$         |
| positive integer solutions     | 각 변수는 1 이상   | $\binom{n-1}{k-1}$           |
| at least one                   | 적어도 한 번 발생함      | Complementary Counting           |
| neither A nor B                | A와 B 어느 쪽에도 해당하지 않음      | Complement / Inclusion–Exclusion |
| both A and B                   | 두 조건을 모두 만족함        | Intersection                     |
| adjacent / together            | 지정된 대상들이 서로 붙어 있어야 함    | Block Method                     |
| not adjacent                   | 지정된 대상들이 서로 붙어 있으면 안 됨    | Total − Adjacent                 |
| grid paths                     | 방향이 고정된 격자 경로   | Lattice Paths                    |
| must pass through              | 특정 점을 반드시 지나야 함      | 두 구간의 경로 수를 곱함                         |
| cannot pass through            | 특정 점을 지나면 안 됨      | 전체 경로 수에서 그 점을 지나는 경로 수를 뺌                      |
| guaranteed / must occur        | 어떤 경우에도 반드시 발생함   | Pigeonhole Principle             |
| no one gets their own item     | 모든 대상이 원래 자리에서 벗어남      | Derangements                     |
| handshakes / pairwise meetings | 모든 쌍을 셈        | $\binom n2$                  |

## 4. 확률 (Probability)

| 문제 조건 / English Keywords   | 판단 방법       | 사용 공식                         |
| ------------------------- | ---------- | ---------------------------- |
| probability of            | 모든 결과가 같은 확률로 발생함      | 유리한 결과 수 / 전체 결과 수                 |
| at least one success      | 적어도 한 번 성공함     | $1-P(\text{no success})$ |
| either A or B             | A 또는 B가 발생함   | Addition Rule                |
| both A and B              | 두 사건이 모두 발생함     | Multiplication Rule          |
| independent               | 두 사건이 서로 영향을 주지 않음     | $P(A)P(B)$               |
| given that                | 특정 사건이 일어났다고 주어짐    | Conditional Probability      |
| without replacement       | 비복원 추출      | 조건부확률 / Hypergeometric        |
| exactly k successes       | 독립 시행을 정해진 횟수만큼 반복함 | Binomial Probability         |
| expected value            | 장기적인 평균 결과     | $\sum x_iP_i$            |
| random point in a region  | 영역에서 균등하게 무작위로 점을 선택함   | 넓이의 비                          |
| random point on a segment | 선분에서 균등하게 무작위로 점을 선택함   | 길이의 비                          |

## 5. 기하 (Geometry)

| 문제 조건 / English Keywords        | 판단 방법       | 사용 공식                                  |
| ------------------------------ | ---------- | ------------------------------------- |
| right triangle                 | 직각삼각형      | Pythagorean Theorem                   |
| 30°, 60°, 90°                  | 특수 직각삼각형    | $1:\sqrt3:2$                      |
| 45°, 45°, 90°                  | 이등변 직각삼각형    | $1:1:\sqrt2$                      |
| three sides given, find area   | 세 변의 길이로 넓이를 구함    | Heron's Formula                       |
| similar triangles              | 대응각이 같고 변의 비가 같음 | Side Ratios / Area Ratios             |
| angle bisector                 | 각의 이등분선이 대변을 나눔    | Angle Bisector Theorem                |
| median                         | 꼭짓점과 대변의 중점을 연결함    | Median Area Property                  |
| centroid                       | 세 중선의 교점     | $2:1$                             |
| inradius / incircle            | 삼각형의 내접원     | $S=rs$                            |
| circumradius / circumcircle    | 삼각형의 외접원     | $S=abc/(4R)$                      |
| altitude to hypotenuse         | 빗변에 내린 높이      | $h^2=mn$                          |
| regular polygon interior angle | 정다각형의 내각     | $\frac{(n-2)180^\circ}{n}$        |
| number of diagonals            | 다각형의 대각선 개수   | $n(n-3)/2$                        |
| arc length                     | 원의 호의 길이       | $\frac{\theta}{360^\circ}2\pi r$  |
| sector area                    | 부채꼴의 넓이       | $\frac{\theta}{360^\circ}\pi r^2$ |
| inscribed angle                | 같은 호에 대한 원주각      | 중심각의 절반                                |
| angle subtended by diameter    | 지름에 대한 원주각    | $90^\circ$                        |
| cyclic quadrilateral           | 원에 내접하는 사각형     | 마주 보는 각은 보각                                  |
| tangent to a circle            | 접선과 반지름      | 수직 관계                                  |
| two tangents from a point      | 같은 원 밖의 한 점에서 그은 두 접선   | 접선의 길이는 서로 같음                                |
| intersecting chords            | 원 안에서 두 현이 만남    | $PA\cdot PB=PC\cdot PD$           |
| secant and tangent             | 원 밖의 할선과 접선    | Power of a Point                      |
| distance from center to chord  | 원 중심에서 현까지의 거리    | $L=2\sqrt{r^2-d^2}$               |
| lattice polygon                | 정수 격자점으로 이루어진 다각형    | Pick's Theorem                        |

## 6. 좌표 및 입체기하 (Coordinate & Solid Geometry)

| 문제 조건        | 사용 공식                       |
| ----------- | -------------------------- |
| 두 점 사이의 거리      | Distance Formula           |
| 두 점의 중점        | Midpoint Formula           |
| 직선의 기울기        | Slope Formula              |
| 한 점과 기울기가 주어짐   | Point–Slope Form           |
| 세 꼭짓점으로 넓이를 구함   | Coordinate Triangle Area   |
| 다각형 꼭짓점의 좌표로 넓이를 구함  | Shoelace Formula           |
| 좌표의 회전 또는 대칭     | Coordinate Transformations |
| 정육면체 또는 직육면체의 대각선  | 3D Pythagorean Theorem     |
| 원기둥의 부피        | $\pi r^2h$             |
| 원뿔의 부피        | $\frac13\pi r^2h$      |
| 구의 부피         | $\frac43\pi r^3$       |
| 구의 겉넓이        | $4\pi r^2$             |
| 닮은 입체도형의 넓이 비     | 길이 비의 제곱                      |
| 닮은 입체도형의 부피 비     | 길이 비의 세제곱                      |
| 다면체의 꼭짓점, 모서리, 면의 개수 | Euler's Polyhedron Formula |

# 제3부: 공식 요약표

이 부분에는 공식, 영어 명칭과 필요한 조건만 정리했습니다.

## 1. 산술 (Arithmetic)

| 영문 명칭                   | 공식                                                      |
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

## 2. 대수 (Algebra)

| 영문 명칭          | 공식                                               |
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

적용 조건: 분모는 0이 아니어야 합니다. 로그의 밑은 양수이면서 1이 아니고 진수는 양수여야 합니다. 근호와 부등식은 해당하는 실수 정의 조건을 만족해야 합니다.

## 3. 수열과 급수 (Sequences & Series)

| 영문 명칭           | 공식                                                    |
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

## 4. 정수론 (Number Theory)

| 영문 명칭               | 공식                                                     |
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

## 5. 조합론 (Combinatorics)

| 영문 명칭                   | 공식                                                     |
| ------------------------------ | ------------------------------------------------------ |
| Addition Principle             | $N=N_1+\cdots+N_k$                                 |
| Multiplication Principle       | $N=N_1\cdots N_k$                                  |
| Ordered with Repetition        | $n^r$                                              |
| Permutations                   | $P(n,r)=\frac{n!}{(n-r)!}$                         |
| Combinations                   | $\binom nr=\frac{n!}{r!(n-r)!}$                    |
| Unordered with Repetition      | $\binom{n+r-1}{r}$                                 |
| Identical Object Permutations  | $\frac{n!}{a_1!\cdots a_k!}$                       |
| Circular Permutations          | $(n-1)!$                                           |
| Circular with Reflection       | $(n-1)!/2$, $n\ge3$; 모든 대상은 서로 달라야 함                     |
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

계수 공식은 순서, 중복 허용 여부, 대상의 구별 가능 여부 및 그 밖의 조건을 만족해야 합니다.

## 6. 확률과 통계 (Probability & Statistics)

| 영문 명칭               | 공식                                                       |
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

## 7. 삼각형 기하 (Triangle Geometry)

| 영문 명칭                | 공식                               |
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

## 8. 다각형과 원 (Polygons & Circles)

| 영문 명칭                   | 공식                                                    |
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

## 9. 좌표기하 (Coordinate Geometry)

| 영문 명칭             | 공식                                                      |
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

평행·수직 기울기 공식은 관련 기울기가 정의될 때만 적용됩니다. 수직선은 별도로 판단해야 합니다.

## 10. 입체기하 (Solid Geometry)

| 영문 명칭                   | 공식                            |
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

## 11. 기타 공식 (Additional Formulae)

| 영문 명칭                | 공식                                                                    |
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

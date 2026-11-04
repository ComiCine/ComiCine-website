---
title: Complete AMC 10 Formula Guide
description: Explanations of arithmetic, algebra, number theory, combinatorics, probability, and geometry formulas for the AMC 10, with problem-recognition strategies and a quick-reference sheet.
outline: [2, 4]
---

# Complete AMC 10 Formula Guide

## Part I: Formula Explanations

### A. Mathematical Notation

| Symbol | English | Meaning and how to calculate |
| --- | --- | --- |
| $\sum$ | Summation | Substitute each value in the specified range in turn, then add the results. |
| $\prod$ | Product | Substitute each value in the specified range in turn, then multiply the results. |
| $n!$ | Factorial | Multiply the integers from 1 to $n$; by definition, $0!=1$. |
| $\binom nr$ | Combination | From $n$ distinct objects, choose $r$, where order does not matter. |
| $\lfloor x\rfloor$ | Floor Function | The greatest integer less than or equal to $x$. |
| $\lceil x\rceil$ | Ceiling Function | The least integer greater than or equal to $x$. |
| $a\mid b$ | Divisibility | $b$ is an integer multiple of $a$. |
| $a\equiv b\pmod m$ | Congruence | $a-b$ is an integer multiple of $m$. |
| $\gcd(a,b)$ | Greatest Common Divisor | The greatest common divisor. |
| $\operatorname{lcm}(a,b)$ | Least Common Multiple | The least common multiple. |
| $\varphi(n)$ | Euler's Totient Function | The number of positive integers from 1 to $n$ that are relatively prime to $n$. |
| $\lvert x\rvert$ | Absolute Value | The distance from $x$ to 0. |
| $A\cap B$ | Intersection | The elements that belong to both A and B. |
| $A\cup B$ | Union | The elements that belong to A or B, including those that belong to both. |
| $A^c$ | Complement | The elements that do not belong to A. |
| $\mathbb Z$ | Integers | The set of integers. |
| $\mathbb R$ | Real Numbers | The set of real numbers. |
| $\forall$ | For All | For every... |
| $\exists$ | There Exists | There is at least one... |
| $\iff$ | If and Only If | If and only if. |

#### A1. Summation

$$ \boxed{\sum_{k=a}^{b}f(k)} $$

How to calculate: Let $k$ start at $a$, increase by 1 each time, and continue through $b$. Add all the resulting values of $f(k)$.

Here:

- $k$: the variable used to calculate each term.
- $a$: the starting value.
- $b$: the ending value.
- $f(k)$: the rule for calculating each term.

#### A2. Product

$$ \boxed{\prod_{k=a}^{b}f(k)} $$

How to calculate: Let $k$ run from $a$ to $b$, calculate each value of $f(k)$, and multiply all the results.

The difference from $\sum$ is that $\sum$ denotes addition, while $\prod$ denotes multiplication.

#### A3. Factorial

$$ \boxed{n!=n(n-1)(n-2)\cdots2\cdot1} $$

Here $n$ is a nonnegative integer, and $0!=1$.

How to calculate: Start at $n$, count down by 1, and multiply all the positive integers.

### B. Arithmetic

#### B1. Fractions

Addition and subtraction:

$$ \boxed{\frac ab\pm\frac cd=\frac{ad\pm bc}{bd}} $$

Multiplication:

$$ \boxed{\frac ab\cdot\frac cd=\frac{ac}{bd}} $$

Division:

$$ \boxed{\frac ab\div\frac cd=\frac{ad}{bc}} $$

How to calculate:

- Addition and subtraction: Use a common denominator, then add or subtract the numerators.
- Multiplication: Multiply the numerators and multiply the denominators.
- Division: Invert the divisor, then multiply.
- Reduce the result to lowest terms.

All denominators must be nonzero, and the divisor must also be nonzero.

#### B2. Ratios

If:

$$ a:b=m:n $$

then:

$$ \boxed{a=km,\qquad b=kn} $$

If the total $S=a+b$ is known:

$$ \boxed{a=\frac{m}{m+n}S} $$

$$ \boxed{b=\frac{n}{m+n}S} $$

How to calculate: Add the ratio terms to find the total number of parts, then allocate the total according to each term's share.

#### B3. Direct and Inverse Proportion

Direct proportion:

$$ \boxed{y=kx} $$

Inverse proportion:

$$ \boxed{xy=k} $$

Here $k$ is the constant of proportionality.

How to calculate:

- Direct proportion: Given one pair of $x,y$ values, calculate $k=y/x$.
- Inverse proportion: Given one pair of $x,y$ values, calculate $k=xy$.
- Use the same $k$ to find other values.

#### B4. Percentage Change

$$ \boxed{N=O(1+r)} $$

Here:

- $O$: Original Value.
- $N$: New Value.
- $r$: the signed rate of change, written as a decimal.

How to calculate:

- For an increase of $r$, multiply the original value by $1+r$.
- For a decrease of $r$, multiply the original value by $1-r$; in this case, $r$ is the positive percentage decrease.

Solve for the rate of change:

$$ \boxed{r=\frac{N-O}{O}} $$

For several successive changes:

$$ \boxed{N=O(1+r_1)(1+r_2)\cdots(1+r_k)} $$

Each change is based on the value immediately before that change.

#### B5. Arithmetic Mean

$$ \boxed{\bar x=\frac{x_1+x_2+\cdots+x_n}{n}} $$

How to calculate: Add all the data values, then divide by the number of values.

Recover the sum:

$$ \boxed{\text{Sum}=n\bar x} $$

#### B6. Weighted Average

$$ \boxed{ \bar x=\frac{w_1x_1+w_2x_2+\cdots+w_nx_n} {w_1+w_2+\cdots+w_n} } $$

Here $w_i$ is the weight corresponding to the data value.

How to calculate: Multiply each value by its corresponding weight, add the products, then divide by the sum of the weights.

#### B7. Speed, Distance, and Time

$$ \boxed{d=vt} $$

$$ \boxed{v=\frac dt} \qquad \boxed{t=\frac dv} $$

Here:

- $d$: Distance.
- $v$: Speed.
- $t$: Time.

How to calculate: Use the two known quantities to find the third, making sure the units are consistent.

Average speed:

$$ \boxed{v_{\mathrm{avg}}=\frac{\text{Total Distance}}{\text{Total Time}}} $$

For a round trip over equal distances at speeds $v_1,v_2$:

$$ \boxed{v_{\mathrm{avg}}=\frac{2v_1v_2}{v_1+v_2}} $$

When two travelers move toward each other, their closing speed is $v_1+v_2$. When one chases the other in the same direction, the closing speed is the difference between their speeds, provided the pursuer is faster.

#### B8. Work and Rate

$$ \boxed{W=rt} $$

Here:

- $W$: the amount of work completed.
- $r$: the amount of work completed per unit of time.
- $t$: the time spent working.

If A and B would take $a,b$ units of time, respectively, to complete the same job alone, and they can work independently at the same time:

$$ \boxed{\frac1T=\frac1a+\frac1b} $$

$$ \boxed{T=\frac{ab}{a+b}} $$

How to calculate: Add the workers' rates, then divide the total amount of work by the combined rate.

#### B9. Mixtures and Concentrations

$$ \boxed{c=\frac{m_{\mathrm{solute}}}{m_{\mathrm{solution}}}} $$

Here:

- $c$: concentration, or mass fraction.
- $m_{\mathrm{solute}}$: mass of the solute.
- $m_{\mathrm{solution}}$: mass of the solution.

When mixing without losing any solute:

$$ \boxed{ c_{\mathrm{new}}= \frac{m_1c_1+m_2c_2}{m_1+m_2} } $$

How to calculate: Find the solute mass in each part, add those masses, then divide by the total mass of the mixture.

#### B10. Compound Growth

$$ \boxed{A=P(1+r)^n} $$

Here:

- $P$: initial amount.
- $A$: final amount.
- $r$: growth rate per period.
- $n$: number of periods.

How to calculate: Multiply by the same growth factor once per period, repeating $n$ times.

If the amount decreases by a proportion $r>0$ each period:

$$ \boxed{A=P(1-r)^n} $$

### C. Algebra

#### C1. Exponent Laws

$$ \boxed{a^ma^n=a^{m+n}} $$

$$ \boxed{\frac{a^m}{a^n}=a^{m-n}} $$

$$ \boxed{(a^m)^n=a^{mn}} $$

$$ \boxed{(ab)^n=a^nb^n} $$

$$ \boxed{a^{-n}=\frac1{a^n}} $$

$$ \boxed{a^{1/n}=\sqrt[n]{a}} $$

How to calculate:

- Multiplying powers with the same base: Add the exponents.
- Dividing powers with the same base: Subtract the exponents.
- Raising a power to a power: Multiply the exponents.
- Negative exponent: Take the reciprocal.
- Fractional exponent: The denominator gives the root, and the numerator gives the power.

For division, the relevant base must be nonzero. For even roots, the expression must satisfy the conditions for a real value.

#### C2. Algebraic Identities

$$ \boxed{(a+b)^2=a^2+2ab+b^2} $$

$$ \boxed{(a-b)^2=a^2-2ab+b^2} $$

$$ \boxed{a^2-b^2=(a-b)(a+b)} $$

$$ \boxed{a^3+b^3=(a+b)(a^2-ab+b^2)} $$

$$ \boxed{a^3-b^3=(a-b)(a^2+ab+b^2)} $$

$$ \boxed{(a+b)^3=a^3+3a^2b+3ab^2+b^3} $$

$$ \boxed{(a-b)^3=a^3-3a^2b+3ab^2-b^3} $$

How to calculate: Check whether the expression has the structure of a square, cube, or difference of squares, then expand or factor it accordingly.

#### C3. Quadratic Formula

For:

$$ ax^2+bx+c=0,\qquad a\ne0 $$

the solutions are:

$$ \boxed{x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}} $$

Discriminant:

$$ \boxed{\Delta=b^2-4ac} $$

How to calculate: Identify $a,b,c$, calculate $\Delta$, and substitute into the quadratic formula.

- $\Delta>0$: two distinct real roots.
- $\Delta=0$: one repeated real root.
- $\Delta<0$: no real roots.

#### C4. Vieta's Formulas

If $r_1,r_2$ are the roots of the quadratic equation $ax^2+bx+c=0$:

$$ \boxed{r_1+r_2=-\frac ba} $$

$$ \boxed{r_1r_2=\frac ca} $$

How to calculate: Use the coefficients to find the sum and product of the roots directly, without solving for the roots first.

Also:

$$ \boxed{r_1^2+r_2^2=(r_1+r_2)^2-2r_1r_2} $$

$$ \boxed{(r_1-r_2)^2=(r_1+r_2)^2-4r_1r_2} $$

Substitute the known sum and product of the roots into these identities.

#### C5. Completing the Square

$$ \boxed{ ax^2+bx+c= a\left(x+\frac{b}{2a}\right)^2+ c-\frac{b^2}{4a} } $$

Here $a\ne0$.

How to calculate:

1. Factor out the coefficient $a$ of the quadratic term.
2. Divide the coefficient of the linear term inside the parentheses by 2.
3. Write the expression as a perfect square.
4. Adjust the remaining constant term.

If $a>0$, the minimum value of the function is:

$$ \boxed{c-\frac{b^2}{4a}} $$

If $a<0$, the same value is the maximum.

The extremum occurs at:

$$ \boxed{x=-\frac b{2a}} $$

#### C6. Absolute Value

$$ \boxed{ |x|= \begin{cases} x,&x\ge0\\ -x,&x<0 \end{cases} } $$

Absolute-value equation:

$$ |x-a|=d $$

If $d\ge0$:

$$ \boxed{x=a\pm d} $$

How to calculate: Interpret absolute value as distance, then look in both directions for positions that satisfy the required distance.

When $d>0$:

$$ \boxed{|x-a|<d\iff a-d<x<a+d} $$

$$ \boxed{|x-a|>d\iff x<a-d\text{ 或 }x>a+d} $$

#### C7. Radicals

$$ \boxed{\sqrt{ab}=\sqrt a\sqrt b} \quad(a,b\ge0) $$

$$ \boxed{\sqrt{a^2}=|a|} $$

Rationalizing the denominator:

$$ \boxed{ \frac1{a+\sqrt b} =\frac{a-\sqrt b}{a^2-b} } $$

For real variables, require $b\ge0$ and $a^2\ne b$; this keeps both the original and rationalized denominators nonzero.

How to calculate: Multiply the numerator and denominator by the conjugate of the denominator, using the difference of squares to remove the radical from the denominator.

#### C8. Arithmetic–Geometric Mean Inequality

For nonnegative real numbers $a,b$:

$$ \boxed{\frac{a+b}{2}\ge\sqrt{ab}} $$

Equivalently:

$$ \boxed{(a+b)^2\ge4ab} $$

How to calculate:

- Given a sum, to find the maximum product, use $ab\le(a+b)^2/4$.
- Given a positive product, to find the minimum sum, use $a+b\ge2\sqrt{ab}$.

Equality holds if and only if $a=b$.

For $n$ nonnegative real numbers:

$$ \boxed{ \frac{x_1+\cdots+x_n}{n} \ge\sqrt[n]{x_1x_2\cdots x_n} } $$

#### C9. Cauchy–Schwarz Inequality

$$ \boxed{ (a^2+b^2)(c^2+d^2)\ge(ac+bd)^2 } $$

General form:

$$ \boxed{ \left(\sum_{i=1}^n a_i^2\right) \left(\sum_{i=1}^n b_i^2\right) \ge \left(\sum_{i=1}^n a_ib_i\right)^2 } $$

How to calculate: Express the target using two sums of squares and a corresponding sum of products, then use the inequality to establish an upper or lower bound.

A common consequence:

$$ \boxed{a^2+b^2\ge\frac{(a+b)^2}{2}} $$

#### C10. Arithmetic Sequences

$$ \boxed{a_n=a_1+(n-1)d} $$

$$ \boxed{S_n=\frac n2(a_1+a_n)} $$

$$ \boxed{S_n=\frac n2[2a_1+(n-1)d]} $$

Here:

- $a_1$: first term.
- $a_n$: $n$th term.
- $d$: common difference.
- $S_n$: sum of the first $n$ terms.

How to calculate:

- To find a specified term: Add $n-1$ common differences to the first term.
- To find the sum: Multiply the number of terms by the average of the first and last terms.
- To find the number of terms: Substitute the sum or specified term into an equation and solve for $n$, then check that it is a positive integer.

#### C11. Geometric Sequences

$$ \boxed{a_n=a_1r^{n-1}} $$

When $r\ne1$:

$$ \boxed{S_n=a_1\frac{1-r^n}{1-r}} $$

If $|r|<1$:

$$ \boxed{S_\infty=\frac{a_1}{1-r}} $$

How to calculate: Each term is multiplied by the fixed common ratio $r$. Choose the formula for the $n$th term, a finite sum, or an infinite sum, as needed.

If $r=1$, the finite sum is simply $na_1$.

#### C12. Standard Sums

The first $n$ positive integers:

$$ \boxed{\sum_{k=1}^n k=\frac{n(n+1)}2} $$

The squares of the first $n$ positive integers:

$$ \boxed{\sum_{k=1}^n k^2=\frac{n(n+1)(2n+1)}6} $$

The cubes of the first $n$ positive integers:

$$ \boxed{\sum_{k=1}^n k^3=\left[\frac{n(n+1)}2\right]^2} $$

The first $n$ positive odd integers:

$$ \boxed{\sum_{k=1}^n(2k-1)=n^2} $$

The first $n$ positive even integers:

$$ \boxed{\sum_{k=1}^n2k=n(n+1)} $$

How to calculate: Identify whether the terms are consecutive integers, squares, cubes, odd numbers, or even numbers, then substitute the number of terms.

#### C13. Telescoping Sums

$$ \boxed{\frac1{k(k+1)}=\frac1k-\frac1{k+1}} $$

Therefore:

$$ \boxed{ \sum_{k=1}^n\frac1{k(k+1)} =1-\frac1{n+1} =\frac n{n+1} } $$

How to calculate:

1. Split each term into the difference of two fractions.
2. Expand the first and last few terms.
3. Cancel matching positive and negative terms.
4. Evaluate only the first and last terms that remain.

#### C14. Binomial Theorem

$$ \boxed{(a+b)^n=\sum_{r=0}^{n}\binom nr a^{n-r}b^r} $$

Here:

$$ \boxed{\binom nr=\frac{n!}{r!(n-r)!}} $$

The term numbered $r+1$:

$$ \boxed{T_{r+1}=\binom nr a^{n-r}b^r} $$

How to calculate:

1. Identify the total exponent $n$.
2. Determine which term or power is required.
3. Find the corresponding $r$.
4. Calculate the combination and the powers of both factors.
5. If there is a negative sign, include it in the corresponding power.

Common combination identities:

$$ \boxed{\binom nr=\binom n{n-r}} $$

$$ \boxed{\binom nr+\binom n{r-1}=\binom{n+1}r} $$

$$ \boxed{\sum_{r=0}^{n}\binom nr=2^n} $$

#### C15. Logarithms

$$ \boxed{a^x=b\iff x=\log_a b} $$

Here $a>0$, $a\ne1$, and $b>0$.

$$ \boxed{\log_a(xy)=\log_a x+\log_a y} $$

$$ \boxed{\log_a\frac xy=\log_a x-\log_a y} $$

$$ \boxed{\log_a(x^r)=r\log_a x} $$

Change-of-base formula:

$$ \boxed{\log_a b=\frac{\log_c b}{\log_c a}} $$

How to calculate: Interpret a logarithm problem as an exponent problem, or combine and expand logarithms using the rules for products, quotients, and powers. All logarithm arguments must be positive.

### D. Number Theory

#### D1. Divisibility

$$ \boxed{a\mid b\iff b=ak,\quad k\in\mathbb Z,\quad a\ne0} $$

How to calculate: Assume $a\ne0$. Check whether $b/a$ is an integer, or check whether $b$ can be written as an integer multiple of $a$.

Divisibility property:

$$ \boxed{ a\mid b,\ a\mid c \Longrightarrow a\mid(mb+nc) } $$

Here $m,n$ are integers.

That is, if $a$ divides both $b,c$, it also divides any integer linear combination of them.

#### D2. Divisibility Tests

| Divisor | Test |
| --- | --- |
| 2 | Check whether the last digit is even. |
| 3 | Add the digits and check whether the sum is a multiple of 3. |
| 4 | Check the number formed by the last two digits. |
| 5 | Check whether the last digit is 0 or 5. |
| 6 | Check divisibility by both 2 and 3. |
| 8 | Check the number formed by the last three digits. |
| 9 | Check whether the digit sum is a multiple of 9. |
| 10 | Check whether the last digit is 0. |
| 11 | Starting from one end, alternately add and subtract the digits; check whether the result is a multiple of 11. |
| 12 | Check divisibility by both 3 and 4. |
| 25 | Check whether the number formed by the last two digits is divisible by 25. |

#### D3. Prime Numbers

A positive integer $p>1$ is prime if and only if its only positive divisors are 1 and $p$.

How to calculate: To determine whether $N>1$ is prime, check only the primes $p$ in the range:

$$ \boxed{p\le\sqrt N} $$

to see whether any of them divides $N$.

If no prime in the range divides it, $N$ is prime.

#### D4. Prime Factorisation

For $N>1$:

$$ \boxed{N=p_1^{a_1}p_2^{a_2}\cdots p_k^{a_k}} $$

How to calculate: Start with the smallest primes and repeatedly divide, combining repeated prime factors as powers.

The $p_i$ are distinct primes, and the $a_i$ are positive integers.

#### D5. Number of Divisors

$$ \boxed{d(N)=\prod_{i=1}^k(a_i+1)} $$

Expanded form:

$$ \boxed{d(N)=(a_1+1)(a_2+1)\cdots(a_k+1)} $$

How to calculate: Add 1 to each prime exponent, then multiply the results.

For $N=1$, the number of divisors is 1.

#### D6. Sum of Divisors

$$ \boxed{ \sigma(N)= \prod_{i=1}^k \left(1+p_i+p_i^2+\cdots+p_i^{a_i}\right) } $$

Equivalently:

$$ \boxed{ \sigma(N)= \prod_{i=1}^k \frac{p_i^{a_i+1}-1}{p_i-1} } $$

How to calculate: For each prime factor, add all its powers from the zeroth power through its highest power, then multiply the sums for all prime factors.

#### D7. Product of Divisors

$$ \boxed{P(N)=N^{d(N)/2}} $$

How to calculate: First find the number of positive divisors $d(N)$, then divide it by 2 and use the result as the exponent of $N$.

The formula still holds even when $d(N)$ is odd.

#### D8. Square Divisors

$$ \boxed{ d_{\mathrm{square}}(N)= \prod_{i=1}^k \left(\left\lfloor\frac{a_i}{2}\right\rfloor+1\right) } $$

How to calculate: For each prime factor, count how many even exponents lie between 0 and $a_i$, then multiply the counts.

#### D9. Perfect Powers

A positive integer $N$ is a perfect $m$th power if and only if every exponent in its prime factorisation is a multiple of $m$.

$$ \boxed{ N=x^m\iff m\mid a_i\text{ 对所有 }i } $$

How to calculate: After factoring into primes, check whether each exponent is divisible by $m$.

#### D10. GCD and LCM

$$ \boxed{\gcd(a,b)\operatorname{lcm}(a,b)=ab} $$

Here $a,b$ are positive integers.

If:

$$ a=\prod p_i^{\alpha_i}, \qquad b=\prod p_i^{\beta_i} $$

treat the exponent of a prime factor that does not appear as 0. Then:

$$ \boxed{\gcd(a,b)=\prod p_i^{\min(\alpha_i,\beta_i)}} $$

$$ \boxed{\operatorname{lcm}(a,b)=\prod p_i^{\max(\alpha_i,\beta_i)}} $$

How to calculate:

- Greatest common divisor: Use the smaller exponent for each prime.
- Least common multiple: Use the larger exponent for each prime.

#### D11. Euclidean Algorithm

$$ \boxed{\gcd(a,b)=\gcd(b,a\bmod b)} $$

How to calculate: Repeatedly replace the two numbers with the divisor and remainder until the remainder is zero. The last nonzero remainder is the GCD.

#### D12. Coprime

$$ \boxed{\gcd(a,b)=1} $$

How to calculate: Check whether the two numbers have any common prime factor greater than 1.

Consecutive integers satisfy:

$$ \boxed{\gcd(n,n+1)=1} $$

#### D13. Euler's Totient Function

$$ \boxed{ \varphi(N)=N\prod_{p\mid N}\left(1-\frac1p\right) } $$

Here:

- $N$: the positive integer for which the count of relatively prime numbers is needed.
- $p\mid N$: $p$ is a prime factor of $N$.
- $\prod_{p\mid N}$: multiply the corresponding factors for each distinct prime factor once.

In expanded form:

$$ \boxed{ \varphi(N)= N\times \frac{p_1-1}{p_1}\times \frac{p_2-1}{p_2}\times\cdots\times \frac{p_k-1}{p_k} } $$

How to calculate: Factor into primes → take each distinct prime once → calculate the corresponding fractions → multiply them by $N$.

If $p$ is prime:

$$ \boxed{\varphi(p)=p-1} $$

If $p$ is prime and $a\ge1$:

$$ \boxed{\varphi(p^a)=p^a-p^{a-1}} $$

By definition:

$$ \boxed{\varphi(1)=1} $$

#### D14. Modular Arithmetic

$$ \boxed{a\equiv b\pmod m} $$

if and only if:

$$ \boxed{m\mid(a-b)} $$

The modulus $m$ is a positive integer.

How to calculate: Find the remainders corresponding to $a,b$ modulo $m$, then check whether they are equal.

Rules for operations:

$$ \boxed{(a+b)\bmod m=((a\bmod m)+(b\bmod m))\bmod m} $$

$$ \boxed{(ab)\bmod m=((a\bmod m)(b\bmod m))\bmod m} $$

$$ \boxed{a^n\bmod m=((a\bmod m)^n)\bmod m} $$

The last formula applies to nonnegative integer exponents.

Note: Division in modular arithmetic cannot be used arbitrarily.

#### D15. Remainder Representation

$$ \boxed{N=dq+r} $$

where:

$$ \boxed{0\le r<d} $$

Here $d$ is a positive divisor, $q$ is the integer quotient, and $r$ is the remainder.

How to calculate: Rewrite “division by $d$ leaves remainder $r$” as $N=dq+r$, then use the other conditions to find the integer $q$.

#### D16. Units Digit Cycles

$$ \boxed{\text{Last digit of }N=N\bmod10} $$

For a power $a^n$, first determine the length $L$ of its units-digit cycle.

Then:

$$ \boxed{r=n\bmod L} $$

How to calculate: Use the exponent remainder $r$ to locate the position in the cycle. If $r=0$, use the last entry in the cycle.

| Units digit of base | Cycle |
| --- | --- |
| 0 | 0 |
| 1 | 1 |
| 2 | 2,4,8,6 |
| 3 | 3,9,7,1 |
| 4 | 4,6 |
| 5 | 5 |
| 6 | 6 |
| 7 | 7,9,3,1 |
| 8 | 8,4,2,6 |
| 9 | 9,1 |

The table applies to positive integer exponents.

For the last two digits, use modulo 100; for the last three digits, use modulo 1000. The cycle must be determined again.

#### D17. Fermat's Little Theorem

If $p$ is prime and $p\nmid a$:

$$ \boxed{a^{p-1}\equiv1\pmod p} $$

How to calculate: Group the large exponent in blocks of $p-1$, using the fact that each block has remainder 1 modulo $p$ to simplify the calculation.

#### D18. Euler's Theorem

If:

$$ \gcd(a,m)=1 $$

then:

$$ \boxed{a^{\varphi(m)}\equiv1\pmod m} $$

How to calculate: First calculate $\varphi(m)$, then use the periodicity of powers to simplify the remainder.

#### D19. Prime Exponents in Factorials

$$ \boxed{ v_p(n!)= \sum_{j=1}^{\infty} \left\lfloor\frac n{p^j}\right\rfloor } $$

Here $p$ must be prime.

In expanded form:

$$ \boxed{ \left\lfloor\frac np\right\rfloor+ \left\lfloor\frac n{p^2}\right\rfloor+ \left\lfloor\frac n{p^3}\right\rfloor+\cdots } $$

How to calculate: Divide by $p,p^2,p^3,\ldots$ in turn, take the floor each time, and add the results until the quotient is less than 1.

#### D20. Trailing Zeros

In base 10:

$$ \boxed{ Z(n!)= \left\lfloor\frac n5\right\rfloor+ \left\lfloor\frac n{25}\right\rfloor+ \left\lfloor\frac n{125}\right\rfloor+\cdots } $$

How to calculate: Count the total exponent of 5 in $n!$, since there are always enough factors of 2.

#### D21. Number Bases

$$ \boxed{ (a_na_{n-1}\cdots a_0)_b =\sum_{i=0}^{n}a_i b^i } $$

Here:

- $b$: the base, an integer with $b\ge2$.
- $a_i$: the digits, with $0\le a_i<b$.

How to calculate: Starting from the rightmost digit, multiply the digits by $b^0,b^1,b^2,\ldots$, respectively, then add the results.

To convert from decimal to base $b$, repeatedly divide by $b$, record the remainders, and read them in reverse order.

#### D22. Digit Sum

Let the base-10 integer $N$ have digit sum $S$:

$$ \boxed{N\equiv S\pmod9} $$

$$ \boxed{N\equiv S\pmod3} $$

How to calculate: Add the digits, then find the sum's remainder when divided by 3 or 9.

#### D23. Reversed Digits

A three-digit number:

$$ \boxed{N=100a+10b+c} $$

Reversed:

$$ \boxed{R=100c+10b+a} $$

Therefore:

$$ \boxed{N-R=99(a-c)} $$

How to calculate: Express each digit times its place value, write expressions for the original and reversed numbers, then subtract.

#### D24. Linear Diophantine Equations

For integers $a,b,c$, with $a,b$ not both zero:

$$ \boxed{ax+by=c} $$

An integer solution exists if and only if:

$$ \boxed{\gcd(a,b)\mid c} $$

How to calculate: First find the GCD and check whether it divides $c$. If it does, use remainders, substitution, or the Euclidean algorithm to find integer solutions.

If positive or nonnegative integer solutions are required, their ranges must also be checked.

#### D25. Counting Multiples

$$ \boxed{ M(1,N;k)=\left\lfloor\frac Nk\right\rfloor } $$

$$ \boxed{ M(A,B;k)= \left\lfloor\frac Bk\right\rfloor- \left\lfloor\frac{A-1}{k}\right\rfloor } $$

Here $A,B,k$ are positive integers, with $A\le B$.

How to calculate: Count the multiples up to the upper endpoint, then subtract the number of multiples below the lower endpoint.

### E. Combinatorics

#### E1. Addition Principle

$$ \boxed{N=N_1+N_2+\cdots+N_k} $$

How to calculate: Count each of the mutually exclusive cases separately, then add the counts.

If the cases overlap, correct for the overlap using the inclusion–exclusion principle.

#### E2. Multiplication Principle

$$ \boxed{N=N_1N_2\cdots N_k} $$

How to calculate: Divide the process into steps, count the choices at each step, then multiply the counts.

The counts for the steps must be valid; if the choices at a step depend on earlier choices, further cases may need to be considered.

#### E3. Permutations

$$ \boxed{P(n,r)=\frac{n!}{(n-r)!}} $$

How to calculate: From $n$ distinct objects, choose $r$, where order matters and repetition is not allowed.

Direct calculation:

$$ \boxed{n(n-1)\cdots(n-r+1)} $$

This is a product of $r$ factors.

#### E4. Combinations

$$ \boxed{\binom nr=\frac{n!}{r!(n-r)!}} $$

How to calculate: From $n$ distinct objects, choose $r$, where order does not matter and repetition is not allowed.

You can first calculate the number of permutations, then divide by $r!$ to remove the different orderings of the same group.

#### E5. Selections with Repetition

Choose from $n$ distinct types a total of $r$ times:

If order matters:

$$ \boxed{n^r} $$

If order does not matter:

$$ \boxed{\binom{n+r-1}{r}} $$

How to calculate:

- Order matters: There are $n$ choices for each position.
- Order does not matter: Use stars and bars to count how many items of each type are chosen.

#### E6. Permutations of Identical Objects

Suppose there are $n$ objects in total, with $a_1,a_2,\ldots,a_k$ identical objects of each type:

$$ \boxed{ N=\frac{n!}{a_1!a_2!\cdots a_k!} } $$

with:

$$ a_1+\cdots+a_k=n $$

How to calculate: First count the permutations as if all objects were distinct, then divide by the number of permutations within each group of identical objects.

#### E7. Circular Permutations

Arrange $n$ distinct objects in a circle, with rotations considered equivalent:

$$ \boxed{(n-1)!} $$

If rotations and reflections are both considered equivalent, and $n\ge3$:

$$ \boxed{\frac{(n-1)!}{2}} $$

How to calculate: Fix one object to eliminate equivalent rotations. If reflections are also equivalent, divide by 2 as well.

#### E8. Stars and Bars

Count the nonnegative integer solutions to:

$$ x_1+x_2+\cdots+x_k=n,\qquad x_i\ge0 $$

$$ \boxed{N=\binom{n+k-1}{k-1}} $$

Count the positive integer solutions to:

$$ x_1+x_2+\cdots+x_k=n,\qquad x_i\ge1 $$

$$ \boxed{N=\binom{n-1}{k-1}} $$

How to calculate:

- If zero is allowed: Arrange $n$ identical objects with $k-1$ dividers.
- If each variable must be at least 1: First give one object to each group, then use the nonnegative-integer formula.

If the variables have different lower bounds $L_i$, set $y_i=x_i-L_i$ first, then use the formula for nonnegative integer solutions.

#### E9. Inclusion–Exclusion Principle

For two sets:

$$ \boxed{|A\cup B|=|A|+|B|-|A\cap B|} $$

For three sets:

$$ \boxed{ \begin{aligned} |A\cup B\cup C| ={}&|A|+|B|+|C|\\ &-|A\cap B|-|A\cap C|-|B\cap C|\\ &+|A\cap B\cap C| \end{aligned} } $$

How to calculate: Add the individual set counts, subtract the pairwise intersections, then add the three-way intersection back. For more sets, continue alternating between addition and subtraction.

#### E10. Complementary Counting

$$ \boxed{N_{\mathrm{wanted}}=N_{\mathrm{total}}-N_{\mathrm{unwanted}}} $$

How to calculate: Count all possibilities, then subtract the ones that do not satisfy the requirement.

#### E11. Block Method

If $k$ specified distinct objects must be adjacent, and there are $n$ distinct objects in total:

$$ \boxed{N=(n-k+1)!\,k!} $$

How to calculate: Treat the specified $k$ objects as one block, arrange the remaining $n-k+1$ units, then multiply by the $k!$ possible internal arrangements.

This formula applies only to linear arrangements with no other restrictions.

#### E12. Lattice Paths

If a path uses only $m$ steps to the right and $n$ steps up:

$$ \boxed{N=\binom{m+n}{m}} $$

How to calculate: There are $m+n$ steps in total. Choose $m$ positions for the steps to the right; the remaining steps must go up.

Paths that must pass through a point P:

$$ \boxed{N=N_{\mathrm{start}\to P}N_{P\to\mathrm{end}}} $$

Paths that are not allowed to pass through a point P:

$$ \boxed{N_{\mathrm{allowed}}=N_{\mathrm{total}}-N_{\mathrm{through}\ P}} $$

The destination and intermediate points must be consistent with the permitted directions of travel.

#### E13. Pigeonhole Principle

If $N$ objects are placed into $k$ categories:

$$ \boxed{ \text{某类别至少包含 } \left\lceil\frac Nk\right\rceil \text{ 个对象} } $$

How to calculate: Divide the number of objects by the number of categories and round up.

To guarantee that some category contains at least $r$ objects:

$$ \boxed{N_{\min}=k(r-1)+1} $$

How to calculate: First place at most $r-1$ objects in every category, then add one more object.

#### E14. Recurrence Relations

$$ \boxed{a_n=f(a_{n-1},a_{n-2},\ldots)} $$

How to calculate: Break the problem of size $n$ into smaller problems, then calculate each term using the initial conditions.

A common Fibonacci recurrence:

$$ \boxed{F_n=F_{n-1}+F_{n-2}} $$

The starting terms must be determined by the definition in the problem.

#### E15. Derangements

Arrange $n$ distinct objects so that none returns to its original position:

$$ \boxed{ D_n=n!\sum_{k=0}^{n}\frac{(-1)^k}{k!} } $$

Expanded form:

$$ \boxed{ D_n=n!\left(1-\frac1{1!}+\frac1{2!} -\frac1{3!}+\cdots+\frac{(-1)^n}{n!}\right) } $$

How to calculate: First count all $n!$ arrangements, then use inclusion–exclusion to exclude arrangements with any fixed positions.

Recurrence form:

$$ \boxed{D_n=(n-1)(D_{n-1}+D_{n-2})} $$

Initial values:

$$ D_0=1,\qquad D_1=0 $$

#### E16. Handshake Lemma

For an undirected graph:

$$ \boxed{\sum_{v\in V}\deg(v)=2E} $$

Here:

- $\deg(v)$: the degree of vertex $v$, or the number of edges connected to it.
- $E$: the total number of edges.

How to calculate: Add the number of edges incident to each vertex, then divide by 2 to get the number of edges.

If $n$ objects are connected in pairs with no duplicate connections:

$$ \boxed{E=\binom n2=\frac{n(n-1)}2} $$

#### E17. Line Intersections

For $n$ distinct lines, with no two parallel and no three concurrent:

$$ \boxed{I=\binom n2} $$

How to calculate: Choose two lines from the set; each pair produces a distinct intersection.

#### E18. Circle Chord Intersections

Given $n$ distinct points on a circle, connect every pair, and assume no three chords intersect at the same interior point:

$$ \boxed{I=\binom n4} $$

How to calculate: Each choice of four points determines a pair of chords that intersect inside the circle, so choose four points from the $n$.

### F. Probability and Statistics

#### F1. Classical Probability

When all elementary outcomes are equally likely:

$$ \boxed{P(A)=\frac{N(A)}{N(S)}} $$

Here:

- $N(A)$: the number of outcomes satisfying event A.
- $N(S)$: the total number of possible elementary outcomes.

How to calculate: Count the outcomes that meet the requirement, then divide by the total number of outcomes.

#### F2. Complement Rule

$$ \boxed{P(A^c)=1-P(A)} $$

How to calculate: Subtract the probability of the complementary event from 1.

#### F3. Addition Rule

$$ \boxed{P(A\cup B)=P(A)+P(B)-P(A\cap B)} $$

If A and B are mutually exclusive:

$$ \boxed{P(A\cup B)=P(A)+P(B)} $$

How to calculate: Add the probabilities of the two events, then subtract the probability of their intersection, which was counted twice.

#### F4. Multiplication Rule

$$ \boxed{P(A\cap B)=P(A)P(B\mid A)} $$

If A and B are independent:

$$ \boxed{P(A\cap B)=P(A)P(B)} $$

How to calculate: Multiply the probability of the first event by the conditional probability of the second event given that the first occurred.

For independent events, the probability of the second event is not affected by the first.

#### F5. Conditional Probability

$$ \boxed{P(A\mid B)=\frac{P(A\cap B)}{P(B)}} $$

This requires $P(B)>0$.

How to calculate: Given that B occurred, consider only the outcomes corresponding to B and find the proportion of those that also satisfy A.

#### F6. Binomial Probability

$$ \boxed{ P(X=k)=\binom nk p^k(1-p)^{n-k} } $$

Here:

- $n$: number of independent trials.
- $k$: required number of successes.
- $p$: probability of success on each trial.
- $X$: total number of successes.

How to calculate:

1. Count the ways to choose the $k$ success positions.
2. Multiply by the probability of $k$ successes.
3. Multiply by the probability of failure on the other $n-k$ trials.

The trials must be independent and have the same probability of success.

#### F7. Hypergeometric Probability

From $N$ distinct objects, draw $n$ without replacement. Of these, $K$ are target objects. The probability of drawing exactly $k$ target objects is:

$$ \boxed{ P(X=k)= \frac{\binom Kk\binom{N-K}{n-k}}{\binom Nn} } $$

How to calculate: Choose the required number from the target group and from the nontarget group, multiply those two combination counts, then divide by the total number of possible selections.

#### F8. Expected Value

$$ \boxed{E(X)=\sum_i x_iP(X=x_i)} $$

How to calculate: Multiply each possible outcome by its probability, then add the products.

Linearity of expectation:

$$ \boxed{E(X+Y)=E(X)+E(Y)} $$

This holds even if the random variables are not independent.

#### F9. Geometric Probability

For a uniform random choice:

$$ \boxed{ P(A)=\frac{\text{Favourable Area}}{\text{Total Area}} } $$

If a random point is uniformly distributed along a line segment:

$$ \boxed{ P(A)=\frac{\text{Favourable Length}}{\text{Total Length}} } $$

How to calculate: Determine whether the basic random quantity is area, length, or another measure, then find the ratio of the favourable part to the whole.

#### F10. Mean, Median, Mode, and Range

Mean:

$$ \boxed{\bar x=\frac{\sum x_i}{n}} $$

Range:

$$ \boxed{R=x_{\max}-x_{\min}} $$

How to calculate:

- Mean: Add the values and divide by the number of values.
- Median: Sort the values and take the middle one; if there is an even number of values, take the mean of the two middle values.
- Mode: Find the value that occurs most often.
- Range: Subtract the minimum value from the maximum.

### G. Plane Geometry

#### G1. Basic Angle Rules

Straight angle:

$$ \boxed{180^\circ} $$

Full turn:

$$ \boxed{360^\circ} $$

Vertically opposite angles:

$$ \boxed{\angle1=\angle2} $$

How to calculate: Use angle relationships involving straight lines, intersecting lines, and parallel lines to form equations from equal or supplementary angles.

When a transversal crosses parallel lines:

- Corresponding Angles are equal.
- Alternate Interior Angles are equal.
- Co-interior Angles sum to $180^\circ$.

#### G2. Triangle Angle Sum

$$ \boxed{A+B+C=180^\circ} $$

Exterior angle theorem:

$$ \boxed{\text{Exterior Angle}=A+B} $$

Here A and B are the two interior angles not adjacent to the exterior angle.

How to calculate: If two interior angles are known, subtract them from 180°. If the two remote interior angles are known, add them to get the corresponding exterior angle.

#### G3. Isosceles and Equilateral Triangles

In an isosceles triangle, equal sides have equal opposite base angles.

For an equilateral triangle:

$$ \boxed{A=B=C=60^\circ} $$

For side length $a$, the height is:

$$ \boxed{h=\frac{\sqrt3}{2}a} $$

Area:

$$ \boxed{S=\frac{\sqrt3}{4}a^2} $$

How to calculate: Draw the height of an equilateral triangle to divide it into two 30°–60°–90° right triangles, then use the side ratios to find the height and area.

#### G4. Triangle Inequality

$$ \boxed{|a-b|<c<a+b} $$

Here $a,b,c>0$.

How to calculate: Given two sides, the third side must be greater than the absolute difference of the two sides and less than their sum.

If the third side must be an integer, count the integers in this open interval.

#### G5. Pythagorean Theorem

For a right triangle:

$$ \boxed{a^2+b^2=c^2} $$

Here $c$ is the hypotenuse.

How to calculate: Given any two side lengths, use the sum or difference of squares to find the third side.

Common integer side triples:

| Legs | Hypotenuse |
| --- | --- |
| 3, 4 | 5 |
| 5, 12 | 13 |
| 8, 15 | 17 |
| 7, 24 | 25 |
| 9, 40 | 41 |
| 20, 21 | 29 |

Integer multiples of these triples also satisfy the Pythagorean theorem.

#### G6. Special Right Triangles

45°–45°–90°

$$ \boxed{1:1:\sqrt2} $$

30°–60°–90°

$$ \boxed{1:\sqrt3:2} $$

How to calculate: Identify the triangle from its angles, use the corresponding side ratio, and take the given side length as the scale factor.

#### G7. Triangle Area

$$ \boxed{S=\frac12 bh} $$

Here:

- $b$: base.
- $h$: perpendicular height corresponding to the base.

How to calculate: Multiply the base by the height, then divide by 2.

For triangles with the same height:

$$ \boxed{\frac{S_1}{S_2}=\frac{b_1}{b_2}} $$

For triangles with the same base:

$$ \boxed{\frac{S_1}{S_2}=\frac{h_1}{h_2}} $$

#### G8. Heron's Formula

$$ \boxed{s=\frac{a+b+c}{2}} $$

$$ \boxed{S=\sqrt{s(s-a)(s-b)(s-c)}} $$

Here $s$ is the semiperimeter.

How to calculate: Given the three side lengths, first find the semiperimeter, then multiply the four factors and take the square root.

#### G9. Similar Triangles

If two triangles are similar and the ratio of corresponding side lengths is $k$:

$$ \boxed{\frac{a_1}{a_2}=k} $$

$$ \boxed{\frac{S_1}{S_2}=k^2} $$

How to calculate: Use the ratio of corresponding sides to find other side lengths. To find the ratio of areas, square the side-length ratio.

Similarity tests:

- AA: Two pairs of corresponding angles are equal.
- SAS: Two pairs of corresponding sides are proportional, and the included angles are equal.
- SSS: All three pairs of corresponding sides are proportional.

#### G10. Congruent Triangles

Common congruence tests are SSS, SAS, ASA, AAS, and RHS/HL.

How to calculate: Determine whether the corresponding sides and angles satisfy a congruence test. Once the triangles are congruent, all corresponding sides, angles, and areas are equal.

#### G11. Angle Bisector Theorem

In triangle $ABC$, $AD$ bisects $\angle A$, and $D$ lies on $BC$:

$$ \boxed{\frac{BD}{DC}=\frac{AB}{AC}} $$

How to calculate: Use the ratio of the two adjacent sides to find the ratio in which the angle bisector divides the opposite side, then use $BD+DC=BC$ to find the lengths.

#### G12. Median and Centroid

If $AD$ is a median of a triangle and $G$ is the centroid:

$$ \boxed{AG:GD=2:1} $$

Therefore:

$$ \boxed{AG=\frac23AD} \qquad \boxed{GD=\frac13AD} $$

How to calculate: Divide the median into 3 equal parts. The segment from the vertex to the centroid is 2 parts, and the segment from the centroid to the midpoint of the opposite side is 1 part.

A median divides a triangle into two equal areas:

$$ \boxed{S_1=S_2} $$

#### G13. Incenter and Incircle

$$ \boxed{S=rs} $$

Here:

- $r$: inradius.
- $s$: semiperimeter of the triangle.
- $S$: area of the triangle.

How to calculate: Divide the area by the semiperimeter to find the inradius, or multiply the inradius by the semiperimeter to find the area.

#### G14. Circumcenter and Circumcircle

$$ \boxed{S=\frac{abc}{4R}} $$

Therefore:

$$ \boxed{R=\frac{abc}{4S}} $$

Here:

- $a,b,c$: side lengths.
- $R$: circumradius.
- $S$: area.

How to calculate: Given the three side lengths and the area, multiply the side lengths and divide by four times the area.

For a right triangle:

$$ \boxed{R=\frac c2} $$

Here $c$ is the hypotenuse.

#### G15. Right Triangle Altitude Theorem

If the hypotenuse has length $c$ and the altitude $h$ divides it into segments $m,n$:

$$ \boxed{c=m+n} $$

$$ \boxed{h^2=mn} $$

The two legs $a,b$ correspond to projections $m,n$, respectively:

$$ \boxed{a^2=cm} $$

$$ \boxed{b^2=cn} $$

How to calculate: Use the ratios of corresponding sides in the similar triangles to form the squared relationships and find the altitude or a leg.

#### G16. Quadrilaterals

| Shape | Formula | Calculation |
| --- | --- | --- |
| Rectangle | $S=lw$ | Multiply length by width. |
| Rectangle Perimeter | $P=2(l+w)$ | Add length and width, then multiply by 2. |
| Square | $S=a^2$ | Square the side length. |
| Square Diagonal | $d=a\sqrt2$ | Multiply the side length by $\sqrt2$. |
| Parallelogram | $S=bh$ | Multiply the base by the perpendicular height. |
| Trapezoid | $S=\frac12(a+b)h$ | Add the two bases, multiply by the height, then divide by 2. |
| Rhombus | $S=\frac12d_1d_2$ | Multiply the diagonals, then divide by 2. |

Here $l,w$ are the length and width, $b,h$ are the base and perpendicular height, and $d_i$ are diagonal lengths.

#### G17. Polygon Angles

Sum of the interior angles of an $n$-gon:

$$ \boxed{(n-2)180^\circ} $$

Each interior angle of a regular $n$-gon:

$$ \boxed{\frac{(n-2)180^\circ}{n}} $$

Each exterior angle of a regular $n$-gon:

$$ \boxed{\frac{360^\circ}{n}} $$

How to calculate: Substitute the number of sides $n$ into the appropriate formula. For a convex polygon, if one exterior angle is taken in the same direction at each vertex, the exterior angles sum to $360^\circ$.

#### G18. Polygon Diagonals

$$ \boxed{D=\frac{n(n-3)}2} $$

How to calculate: From each vertex, draw diagonals to the $n-3$ nonadjacent vertices, multiply by $n$, then divide by 2 to remove duplicate counts.

#### G19. Regular Polygon Area

$$ \boxed{S=\frac12Pa} $$

Here:

- $P$: perimeter.
- $a$: apothem, the perpendicular distance from the centre to a side.

How to calculate: Multiply the perimeter by the apothem, then divide by 2.

For a regular hexagon with side length $s$:

$$ \boxed{S=\frac{3\sqrt3}{2}s^2} $$

#### G20. Circle

Circumference:

$$ \boxed{C=2\pi r} $$

Area:

$$ \boxed{S=\pi r^2} $$

Diameter:

$$ \boxed{d=2r} $$

How to calculate: Use the radius in the relevant formula.

#### G21. Arc Length

For a central angle of $\theta^\circ$:

$$ \boxed{L=\frac{\theta}{360^\circ}2\pi r} $$

How to calculate: Divide the central angle by 360° to find the fraction of the circle represented by the arc, then multiply by the full circumference.

#### G22. Sector Area

$$ \boxed{S_{\mathrm{sector}}=\frac{\theta}{360^\circ}\pi r^2} $$

How to calculate: Multiply the area of the circle by the fraction of 360° represented by the central angle.

Segment area:

$$ \boxed{S_{\mathrm{segment}}=S_{\mathrm{sector}}-S_{\mathrm{triangle}}} $$

Annulus area:

$$ \boxed{S_{\mathrm{annulus}}=\pi(R^2-r^2)} $$

#### G23. Inscribed Angle Theorem

For the same arc:

$$ \boxed{\theta_{\mathrm{inscribed}}=\frac12\theta_{\mathrm{central}}} $$

How to calculate: Divide the central angle by 2 to get the inscribed angle subtending the same arc.

An angle subtended by a semicircle:

$$ \boxed{90^\circ} $$

#### G24. Cyclic Quadrilaterals

For a cyclic quadrilateral $ABCD$:

$$ \boxed{A+C=180^\circ} $$

$$ \boxed{B+D=180^\circ} $$

How to calculate: Given one interior angle, subtract it from $180^\circ$ to find the opposite angle.

#### G25. Tangents

The radius is perpendicular to the tangent at the point of tangency:

$$ \boxed{OT\perp PT} $$

For two tangents PA and PB from the same external point P:

$$ \boxed{PA=PB} $$

How to calculate: Use the perpendicular relationship to form a right triangle, or use the equal lengths of tangents from the same point.

#### G26. Chord Length

For a circle of radius $r$, with perpendicular distance $d$ from the centre to the chord:

$$ \boxed{L=2\sqrt{r^2-d^2}} $$

How to calculate: Bisect the chord, use the Pythagorean theorem to find half its length, then multiply by 2.

#### G27. Intersecting Chords Theorem

Two chords $AB,CD$ intersect at P inside a circle:

$$ \boxed{PA\cdot PB=PC\cdot PD} $$

How to calculate: Multiply the lengths of the two segments on each chord, then set the products equal.

#### G28. Power of a Point

Two secants from the same external point P:

$$ \boxed{PA\cdot PB=PC\cdot PD} $$

Here A and C are the nearer intersections with the circle, and B and D are the farther intersections.

For a tangent PT and secant PAB:

$$ \boxed{PT^2=PA\cdot PB} $$

How to calculate: Multiply the external segment by the full length from P to the farther intersection. For a tangent, square its length.

#### G29. Circle Intersection Angles

Two chords intersect inside a circle:

$$ \boxed{\theta=\frac{\alpha+\beta}{2}} $$

Two secants intersect outside a circle:

$$ \boxed{\theta=\frac{\alpha-\beta}{2}} $$

Here $\alpha,\beta$ are the measures of the corresponding intercepted arcs. In the second formula, subtract the nearer arc from the farther arc.

How to calculate: Depending on whether the intersection is inside or outside the circle, add or subtract the arc measures, then divide by 2.

### H. Coordinate Geometry

#### H1. Distance Formula

$$ \boxed{ d=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2} } $$

How to calculate: Square the difference of the x-coordinates, add the square of the difference of the y-coordinates, then take the square root.

#### H2. Midpoint Formula

$$ \boxed{ M=\left(\frac{x_1+x_2}{2},\frac{y_1+y_2}{2}\right) } $$

How to calculate: Find the mean of the two x-coordinates and the mean of the two y-coordinates.

#### H3. Slope

$$ \boxed{m=\frac{y_2-y_1}{x_2-x_1}} $$

This requires $x_1\ne x_2$.

How to calculate: Divide the change in the y-coordinate by the change in the x-coordinate.

#### H4. Equations of Lines

Slope–intercept form:

$$ \boxed{y=mx+c} $$

Point–slope form:

$$ \boxed{y-y_1=m(x-x_1)} $$

Condition for parallel nonvertical lines:

$$ \boxed{m_1=m_2} $$

Condition for perpendicular lines, when both slopes exist:

$$ \boxed{m_1m_2=-1} $$

How to calculate: Given a point and a slope, use point–slope form. Given two points, first calculate the slope, then substitute one of the points.

#### H5. Triangle Area from Coordinates

$$ \boxed{ S=\frac12\left| x_1(y_2-y_3)+x_2(y_3-y_1)+x_3(y_1-y_2) \right| } $$

How to calculate: Multiply across and add as indicated by the formula, then take the absolute value and divide by 2.

#### H6. Shoelace Formula

For polygon vertices listed in boundary order:

$$ (x_1,y_1),\ldots,(x_n,y_n) $$

Set:

$$ x_{n+1}=x_1,\qquad y_{n+1}=y_1 $$

Area:

$$ \boxed{ S=\frac12\left| \sum_{i=1}^n x_i y_{i+1} - \sum_{i=1}^n y_i x_{i+1} \right| } $$

How to calculate: Add the products along one diagonal direction, add the products in the opposite direction, subtract the sums, take the absolute value, and divide by 2.

#### H7. Pick's Theorem

Applies to a simple polygon whose vertices lie on lattice points:

$$ \boxed{S=I+\frac B2-1} $$

Here:

- $I$: number of lattice points strictly inside the polygon.
- $B$: number of lattice points on the polygon's boundary.

How to calculate: Add the number of interior lattice points to half the number of boundary lattice points, then subtract 1.

#### H8. Coordinate Transformations

| Transformation | New coordinates |
| --- | --- |
| Reflection across the x-axis | $(x,-y)$ |
| Reflection across the y-axis | $(-x,y)$ |
| Reflection across the origin | $(-x,-y)$ |
| 90° counterclockwise rotation | $(-y,x)$ |
| 90° clockwise rotation | $(y,-x)$ |
| 180° rotation | $(-x,-y)$ |
| Translation by $(a,b)$ | $(x+a,y+b)$ |

Rotations are centred at the origin.

### I. Solid Geometry

#### I1. Cube

For side length $a$:

$$ \boxed{V=a^3} $$

$$ \boxed{S=6a^2} $$

Space diagonal:

$$ \boxed{d=a\sqrt3} $$

How to calculate: Cube the side length for the volume. Add the areas of the six equal squares for the surface area. Use the three-dimensional Pythagorean relationship for the space diagonal.

#### I2. Rectangular Prism

$$ \boxed{V=lwh} $$

$$ \boxed{S=2(lw+lh+wh)} $$

$$ \boxed{d=\sqrt{l^2+w^2+h^2}} $$

Here $l,w,h$ are the length, width, and height, respectively.

#### I3. Cylinder

$$ \boxed{V=\pi r^2h} $$

$$ \boxed{S=2\pi r^2+2\pi rh} $$

How to calculate: Multiply the base area by the height to find the volume. Add the areas of the two circular bases and the lateral surface to find the total surface area.

#### I4. Cone

$$ \boxed{V=\frac13\pi r^2h} $$

Lateral area:

$$ \boxed{S_{\mathrm{lateral}}=\pi rl} $$

For a right circular cone:

$$ \boxed{l=\sqrt{r^2+h^2}} $$

Here $l$ is the slant height.

Total surface area:

$$ \boxed{S=\pi r^2+\pi rl} $$

#### I5. Sphere

$$ \boxed{V=\frac43\pi r^3} $$

$$ \boxed{S=4\pi r^2} $$

How to calculate: Multiply the cube of the radius by $4\pi/3$ for the volume, and multiply the square of the radius by $4\pi$ for the surface area.

#### I6. Prism and Pyramid

Prism:

$$ \boxed{V=S_{\mathrm{base}}h} $$

Pyramid:

$$ \boxed{V=\frac13S_{\mathrm{base}}h} $$

How to calculate: Multiply the base area by the perpendicular height. For a pyramid, divide the result by 3.

#### I7. Similar Solids

If the ratio of corresponding lengths is $k$:

$$ \boxed{\frac{S_1}{S_2}=k^2} $$

$$ \boxed{\frac{V_1}{V_2}=k^3} $$

How to calculate: The area ratio is the square of the length ratio, and the volume ratio is the cube of the length ratio.

#### I8. Euler's Polyhedron Formula

For a convex polyhedron:

$$ \boxed{V-E+F=2} $$

Here:

- $V$: number of vertices.
- $E$: number of edges.
- $F$: number of faces.

How to calculate: Substitute the two known quantities into the formula and solve for the third.

### J. Other Mathematical Techniques

#### J1. Parity

Even integer:

$$ \boxed{2k} $$

Odd integer:

$$ \boxed{2k+1} $$

Here $k\in\mathbb Z$.

How to calculate: Express integers in the forms $2m$ or $2m+1$, simplify the result, then determine whether it is even or odd.

#### J2. Invariants

If an operation always changes a number by $km$, then:

$$ \boxed{N_{\mathrm{new}}\equiv N_{\mathrm{old}}\pmod m} $$

How to calculate: Look for a remainder, parity, difference in colour counts, or other quantity that does not change under each operation. Use it to determine whether a particular outcome is possible.

#### J3. Bounds

$$ \boxed{L\le x\le U} $$

Here $L$ is a lower bound and $U$ is an upper bound.

How to calculate: Use nonnegativity, comparisons, monotonicity, or inequalities to establish a range, then compare it with the answer choices or integer conditions.

#### J4. Symmetric Expressions

Given:

$$ s=a+b,\qquad p=ab $$

then:

$$ \boxed{a^2+b^2=s^2-2p} $$

$$ \boxed{a^3+b^3=s^3-3ps} $$

$$ \boxed{(a-b)^2=s^2-4p} $$

How to calculate: Express higher powers of two numbers in terms of their sum and product, avoiding the need to find $a,b$ first.

#### J5. Clock Angles

Using a 12-hour clock, let $h\in\{0,1,\ldots,11\}$, and let $m$ be the number of minutes:

Hour hand angle:

$$ \boxed{\theta_h=30h+0.5m} $$

Minute hand angle:

$$ \boxed{\theta_m=6m} $$

Difference in angles:

$$ \boxed{\Delta=|30h-5.5m|} $$

Smaller angle:

$$ \boxed{\theta=\min(\Delta,360^\circ-\Delta)} $$

How to calculate: Find the angle of each hand measured from the 12 o'clock direction, find the difference, then take the smaller angle.

#### J6. Double Counting

Core relationship:

$$ \boxed{\text{Count by Method A}=\text{Count by Method B}} $$

How to calculate: Count the same objects or relationships in two different ways and set the counts equal to solve for the unknown.

A common example:

$$ \boxed{\sum\deg(v)=2E} $$

#### J7. AM–GM for Multiple Nonnegative Numbers

For nonnegative real numbers $x_1,\ldots,x_n$:

$$ \boxed{ \frac{x_1+\cdots+x_n}{n} \ge\sqrt[n]{x_1x_2\cdots x_n} } $$

How to calculate: When the sum of nonnegative variables is fixed, use this inequality to find an upper bound for their product. When their product is a fixed positive number, use it to find a lower bound for their sum.

Equality holds when all the variables are equal.

## Part II: How to Choose a Formula

This section groups problems by the English keywords in the question, the given conditions, and what is being asked.

The same keyword may point to different formulas; choose based on the actual restrictions in the problem.

### 1. Arithmetic and Algebra

| Problem conditions / English Keywords | How to recognize it | Formula to use |
| --- | --- | --- |
| percentage increase / decrease | A quantity increases or decreases by a percentage. | $N=O(1+r)$ |
| average / mean | The total and the number of values are known. | $\bar x=\frac{\sum x_i}{n}$ |
| combined average | The groups have different numbers of data points. | Weighted Average |
| average speed | Total distance and total time. | $v=\frac dt$ |
| same distance, different speeds | A round trip over equal distances. | $\frac{2ab}{a+b}$ |
| working together | Several people complete a task at the same time. | $\frac1T=\frac1a+\frac1b$ |
| concentration / mixture | Mixtures with different concentrations. | Total solute amount divided by total mixture amount. |
| constant difference | The difference between consecutive terms is fixed. | Arithmetic Sequence |
| constant ratio | The ratio between consecutive terms is fixed. | Geometric Sequence |
| sum of consecutive integers | Sum of consecutive integers. | $\frac{n(n+1)}2$ |
| sum of squares | Sum of squares of consecutive integers. | $\frac{n(n+1)(2n+1)}6$ |
| sum of cubes | Sum of cubes of consecutive integers. | $[\frac{n(n+1)}2]^2$ |
| fractional terms cancel | Adjacent fractions can be split and cancelled. | Telescoping Sum |
| roots of a quadratic | The roots need to be found. | Quadratic Formula |
| sum/product of roots | Only the sum or product of the roots is needed. | Vieta's Formulas |
| maximum / minimum of a quadratic | Find an extremum of a quadratic function. | Completing the Square |
| fixed sum, maximum product | The sum of nonnegative variables is fixed. | AM–GM |
| fixed positive product, minimum sum | The product of positive variables is fixed. | AM–GM |
| distance from a number | Distance on a number line. | Absolute Value |
| coefficient of a term | Find the coefficient of a specified term in a binomial expansion. | Binomial Theorem |
| exponential growth | A fixed percentage change occurs each period. | Compound Growth |

### 2. Number Theory

| Problem conditions / English Keywords | How to recognize it | Formula to use |
| --- | --- | --- |
| prime number | Determine whether a number is prime. | Check prime factors no greater than $\sqrt N$. |
| prime factorisation | Factor into primes. | $N=\prod p_i^{a_i}$ |
| number of positive divisors / factors | Count positive divisors. | $\prod(a_i+1)$ |
| sum of all factors | Sum the positive divisors. | $\prod(1+p_i+\cdots+p_i^{a_i})$ |
| product of all factors | Find the product of the positive divisors. | $N^{d(N)/2}$ |
| greatest common divisor | Find the greatest common divisor. | GCD / Euclidean Algorithm |
| least common multiple | Find the least common multiple. | LCM |
| relatively prime / coprime | Determine whether two numbers are coprime. | $\gcd(a,b)=1$ |
| how many numbers are coprime to n | Count the numbers from 1 to n that are coprime to n. | Euler's Totient Function |
| remainder when divided by | Find a remainder. | Modular Arithmetic |
| last digit | Find the units digit. | Modulo 10 |
| last two digits | Find the last two digits. | Modulo 100 |
| large integer powers | Find the remainder of a large power. | Powers Cycle / Fermat / Euler |
| trailing zeros of n! | Find the trailing zeros in a factorial. | Legendre's Formula |
| perfect square | Determine whether a number is a perfect square. | Every prime exponent is even. |
| perfect cube | Determine whether a number is a perfect cube. | Every prime exponent is a multiple of 3. |
| number of square divisors | Count the perfect-square divisors. | $\prod(\lfloor a_i/2\rfloor+1)$ |
| integer solutions | Solve an integer equation. | GCD / Modular Arithmetic |
| multiples between A and B | Count multiples in an interval. | Floor Function |
| binary / base-n | Work with number bases. | Positional Number Formula |
| sum of digits | Use the digit sum to test divisibility. | Modulo 3 / 9 |
| reversed digits | Work with a number whose digits are reversed. | Place-value expansion |

### 3. Counting

First determine whether order matters, then whether repetition is allowed:

| Does order matter? | Is repetition allowed? | Formula | When to use it |
| --- | --- | --- | --- |
| Yes | No | $P(n,r)=\frac{n!}{(n-r)!}$ | From $n$ distinct objects, choose $r$, where order matters and repetition is not allowed. |
| Yes | Yes | $n^r$ | There are $n$ choices each time, for $r$ choices in total; order matters and repetition is allowed. |
| No | No | $\binom nr$ | From $n$ distinct objects, choose $r$, where order does not matter and repetition is not allowed. |
| No | Yes | $\binom{n+r-1}{r}$ | Choose from $n$ types a total of $r$ objects, where order does not matter and repetition is allowed. |

This decision applies to basic selection problems without additional adjacency, position, or quantity-bound restrictions.

Other counting problems:

| English Keywords / Conditions | How to recognize it | Formula to use |
| --- | --- | --- |
| identical objects | Some objects are identical and indistinguishable. | Repeated Permutations |
| around a round table | Circular arrangements where rotations are equivalent. | $(n-1)!$ |
| necklace, flipping allowed | Rotations and reflections of a necklace are equivalent. | $(n-1)!/2$, provided the objects are distinct and the other conditions are met. |
| distribute identical items | Distribute identical objects among distinct groups. | Stars and Bars |
| nonnegative integer solutions | Distribute as nonnegative integers. | $\binom{n+k-1}{k-1}$ |
| positive integer solutions | Each variable must be at least 1. | $\binom{n-1}{k-1}$ |
| at least one | At least one occurrence is required. | Complementary Counting |
| neither A nor B | Neither of two conditions is satisfied. | Complement / Inclusion–Exclusion |
| both A and B | Find the intersection of two conditions. | Intersection |
| adjacent / together | Specified objects must be adjacent. | Block Method |
| not adjacent | Specified objects must not be adjacent. | Total − Adjacent |
| grid paths | Lattice paths with fixed directions. | Lattice Paths |
| must pass through | The path must go through a specified point. | Multiply the counts for the two path segments. |
| cannot pass through | The path must avoid a specified point. | Total paths minus paths through that point. |
| guaranteed / must occur | An outcome must occur in every arrangement. | Pigeonhole Principle |
| no one gets their own item | Every object is out of its original position. | Derangements |
| handshakes / pairwise meetings | Count pairs of objects. | $\binom n2$ |

### 4. Probability

| Problem conditions / English Keywords | How to recognize it | Formula to use |
| --- | --- | --- |
| probability of | Equally likely outcomes. | Number of favourable outcomes / total number of outcomes. |
| at least one success | At least one success occurs. | $1-P(\text{no success})$ |
| either A or B | Event A or event B occurs. | Addition Rule |
| both A and B | Both events occur. | Multiplication Rule |
| independent | The events do not affect one another. | $P(A)P(B)$ |
| given that | One event is known to have occurred. | Conditional Probability |
| without replacement | Sampling without replacement. | Conditional Probability / Hypergeometric |
| exactly k successes | A fixed number of independent repeated trials. | Binomial Probability |
| expected value | Long-run average outcome. | $\sum x_iP_i$ |
| random point in a region | A point is chosen uniformly at random from a region. | Area ratio |
| random point on a segment | A point is chosen uniformly at random from a line segment. | Length ratio |

### 5. Geometry

| Problem conditions / English Keywords | How to recognize it | Formula to use |
| --- | --- | --- |
| right triangle | A right triangle. | Pythagorean Theorem |
| 30°, 60°, 90° | A special right triangle. | $1:\sqrt3:2$ |
| 45°, 45°, 90° | An isosceles right triangle. | $1:1:\sqrt2$ |
| three sides given, find area | The three side lengths are known and the area is required. | Heron's Formula |
| similar triangles | Corresponding angles are equal and sides are proportional. | Side Ratios / Area Ratios |
| angle bisector | An angle bisector divides the opposite side. | Angle Bisector Theorem |
| median | A segment joins a vertex to the midpoint of the opposite side. | Median Area Property |
| centroid | The intersection of the three medians. | $2:1$ |
| inradius / incircle | The incircle of a triangle. | $S=rs$ |
| circumradius / circumcircle | The circumcircle of a triangle. | $S=abc/(4R)$ |
| altitude to hypotenuse | An altitude to the hypotenuse. | $h^2=mn$ |
| regular polygon interior angle | An interior angle of a regular polygon. | $\frac{(n-2)180^\circ}{n}$ |
| number of diagonals | Count the diagonals of a polygon. | $n(n-3)/2$ |
| arc length | Find the length of an arc. | $\frac{\theta}{360^\circ}2\pi r$ |
| sector area | Find the area of a sector. | $\frac{\theta}{360^\circ}\pi r^2$ |
| inscribed angle | An inscribed angle subtends the same arc. | Half the central angle. |
| angle subtended by diameter | An inscribed angle subtended by a diameter. | $90^\circ$ |
| cyclic quadrilateral | A quadrilateral inscribed in a circle. | Opposite angles are supplementary. |
| tangent to a circle | A tangent and the radius at the point of tangency. | Perpendicular relationship. |
| two tangents from a point | Tangents from the same external point. | The tangent lengths are equal. |
| intersecting chords | Two chords intersect inside a circle. | $PA\cdot PB=PC\cdot PD$ |
| secant and tangent | A secant and tangent from an external point. | Power of a Point |
| distance from center to chord | Distance from the centre to a chord. | $L=2\sqrt{r^2-d^2}$ |
| lattice polygon | A polygon with lattice-point vertices. | Pick's Theorem |

### 6. Coordinate and Solid Geometry

| Problem condition | Formula to use |
| --- | --- |
| Distance between two points | Distance Formula |
| Midpoint of two points | Midpoint Formula |
| Slope of a line | Slope Formula |
| A point and a known slope | Point–Slope Form |
| Area from three vertices | Coordinate Triangle Area |
| Area from polygon vertex coordinates | Shoelace Formula |
| Coordinate rotation or reflection | Coordinate Transformations |
| Diagonal of a cube or rectangular prism | 3D Pythagorean Theorem |
| Volume of a cylinder | $\pi r^2h$ |
| Volume of a cone | $\frac13\pi r^2h$ |
| Volume of a sphere | $\frac43\pi r^3$ |
| Surface area of a sphere | $4\pi r^2$ |
| Surface-area ratio of similar solids | Square of the length ratio. |
| Volume ratio of similar solids | Cube of the length ratio. |
| Number of vertices, edges, and faces of a polyhedron | Euler's Polyhedron Formula |

## Part III: Formula Quick Reference

This section lists only the formulas, their English names, and essential conditions.

### 1. Arithmetic

| Formula Name | Formula |
| --- | --- |
| Percentage Change | $N=O(1+r)$ |
| Percentage Rate | $r=\frac{N-O}{O}$ |
| Arithmetic Mean | $\bar x=\frac{\sum x_i}{n}$ |
| Weighted Average | $\bar x=\frac{\sum w_ix_i}{\sum w_i}$ |
| Distance | $d=vt$ |
| Average Speed | $v=\frac{\text{Total distance}}{\text{Total time}}$ |
| Equal-distance Average Speed | $v=\frac{2ab}{a+b}$ |
| Work Rate | $W=rt$ |
| Combined Work | $\frac1T=\frac1a+\frac1b$ |
| Concentration | $c=\frac{\text{Solute}}{\text{Solution}}$ |
| Compound Growth | $A=P(1+r)^n$ |

### 2. Algebra

| Formula Name | Formula |
| --- | --- |
| Product of Powers | $a^ma^n=a^{m+n}$ |
| Quotient of Powers | $a^m/a^n=a^{m-n}$ |
| Power of a Power | $(a^m)^n=a^{mn}$ |
| Negative Exponent | $a^{-n}=1/a^n$ |
| Perfect Square | $(a\pm b)^2=a^2\pm2ab+b^2$ |
| Difference of Squares | $a^2-b^2=(a-b)(a+b)$ |
| Sum of Cubes | $a^3+b^3=(a+b)(a^2-ab+b^2)$ |
| Difference of Cubes | $a^3-b^3=(a-b)(a^2+ab+b^2)$ |
| Quadratic Formula | $x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}$ |
| Discriminant | $\Delta=b^2-4ac$ |
| Vieta: Sum | $r_1+r_2=-b/a$ |
| Vieta: Product | $r_1r_2=c/a$ |
| Quadratic Vertex | $x=-b/(2a)$ |
| Quadratic Extremum | $y=c-b^2/(4a)$ |
| AM–GM | $\frac{a+b}{2}\ge\sqrt{ab}$, $a,b\ge0$ |
| Cauchy–Schwarz | $(\sum a_i^2)(\sum b_i^2)\ge(\sum a_ib_i)^2$ |
| Logarithm Definition | $a^x=b\iff x=\log_a b$ |
| Log Product | $\log_a(xy)=\log_a x+\log_a y$ |
| Log Quotient | $\log_a(x/y)=\log_a x-\log_a y$ |
| Log Power | $\log_a(x^r)=r\log_a x$ |
| Change of Base | $\log_a b=\frac{\log_c b}{\log_c a}$ |

Conditions: Denominators must be nonzero. Logarithm bases must be positive and not equal to 1, and logarithm arguments must be positive. Radicals and inequalities must satisfy their corresponding real-number conditions.

### 3. Sequences and Series

| Formula Name | Formula |
| --- | --- |
| Arithmetic nth Term | $a_n=a_1+(n-1)d$ |
| Arithmetic Sum | $S_n=\frac n2[2a_1+(n-1)d]$ |
| Geometric nth Term | $a_n=a_1r^{n-1}$ |
| Geometric Sum | $S_n=a_1\frac{1-r^n}{1-r}$, $r\ne1$ |
| Infinite Geometric Sum | $S_\infty=\frac{a_1}{1-r}$, $\lvert r \rvert<1$ |
| Sum of Integers | $\sum_{k=1}^n k=\frac{n(n+1)}2$ |
| Sum of Squares | $\sum_{k=1}^n k^2=\frac{n(n+1)(2n+1)}6$ |
| Sum of Cubes | $\sum_{k=1}^n k^3=\left[\frac{n(n+1)}2\right]^2$ |
| Sum of Odd Numbers | $\sum_{k=1}^n(2k-1)=n^2$ |
| Sum of Even Numbers | $\sum_{k=1}^n2k=n(n+1)$ |
| Telescoping Identity | $\frac1{k(k+1)}=\frac1k-\frac1{k+1}$ |
| Binomial Theorem | $(a+b)^n=\sum_{r=0}^n\binom nr a^{n-r}b^r$ |
| Binomial Coefficient | $\binom nr=\frac{n!}{r!(n-r)!}$ |
| Pascal's Identity | $\binom nr+\binom n{r-1}=\binom{n+1}r$ |
| Sum of Combinations | $\sum_{r=0}^n\binom nr=2^n$ |

### 4. Number Theory

| Formula Name | Formula |
| --- | --- |
| Prime Factorisation | $N=\prod p_i^{a_i}$ |
| Number of Divisors | $d(N)=\prod(a_i+1)$ |
| Sum of Divisors | $\sigma(N)=\prod\frac{p_i^{a_i+1}-1}{p_i-1}$ |
| Product of Divisors | $P(N)=N^{d(N)/2}$ |
| Square Divisor Count | $\prod(\lfloor a_i/2\rfloor+1)$ |
| GCD–LCM Identity | $\gcd(a,b)\operatorname{lcm}(a,b)=ab$, $a,b>0$ |
| Euclidean Algorithm | $\gcd(a,b)=\gcd(b,a\bmod b)$ |
| Coprime | $\gcd(a,b)=1$ |
| Euler's Totient | $\varphi(N)=N\prod_{p\mid N}(1-\frac1p)$ |
| Prime Totient | $\varphi(p)=p-1$ |
| Prime Power Totient | $\varphi(p^a)=p^a-p^{a-1}$ |
| Congruence | $a\equiv b\pmod m\iff m\mid(a-b)$ |
| Division Algorithm | $N=dq+r,\quad0\le r<d$ |
| Fermat's Little Theorem | $a^{p-1}\equiv1\pmod p$, $p\nmid a$ |
| Euler's Theorem | $a^{\varphi(m)}\equiv1\pmod m$, $\gcd(a,m)=1$ |
| Legendre's Formula | $v_p(n!)=\sum_{j\ge1}\lfloor n/p^j\rfloor$ |
| Trailing Zeros of $n!$ | $\sum_{j\ge1}\lfloor n/5^j\rfloor$ |
| Perfect Square | $N=\prod p_i^{a_i},\quad 2\mid a_i\ \forall i$ |
| Perfect Cube | $N=\prod p_i^{a_i},\quad 3\mid a_i\ \forall i$ |
| Square Residues Modulo 4 | $n^2\equiv0,1\pmod4$ |
| Base-$b$ Expansion | $N=\sum_{i=0}^n a_ib^i$ |
| Digit Sum | $N\equiv\sum \text{digits}\pmod9$ |
| Integer Equation Criterion | $\gcd(a,b)\mid c$ for $ax+by=c$ |
| Multiples from 1 to N | $\lfloor N/k\rfloor$ |
| Multiples from A to B | $\lfloor B/k\rfloor-\lfloor(A-1)/k\rfloor$ |

### 5. Combinatorics

| Formula Name | Formula |
| --- | --- |
| Addition Principle | $N=N_1+\cdots+N_k$ |
| Multiplication Principle | $N=N_1\cdots N_k$ |
| Ordered with Repetition | $n^r$ |
| Permutations | $P(n,r)=\frac{n!}{(n-r)!}$ |
| Combinations | $\binom nr=\frac{n!}{r!(n-r)!}$ |
| Unordered with Repetition | $\binom{n+r-1}{r}$ |
| Identical Object Permutations | $\frac{n!}{a_1!\cdots a_k!}$ |
| Circular Permutations | $(n-1)!$ |
| Circular with Reflection | $(n-1)!/2$, $n\ge3$, with distinct objects |
| Nonnegative Integer Solutions | $\binom{n+k-1}{k-1}$ |
| Positive Integer Solutions | $\binom{n-1}{k-1}$ |
| Two-set Inclusion–Exclusion | $\lvert A\cup B \rvert=\lvert A \rvert+\lvert B \rvert-\lvert A\cap B \rvert$ |
| Complement Counting | $N_{\rm wanted}=N_{\rm total}-N_{\rm unwanted}$ |
| Block Method | $(n-k+1)!k!$ |
| Lattice Paths | $\binom{m+n}{m}$ |
| Pigeonhole Principle | $\lceil N/k\rceil$ |
| Minimum for $r$ in One Box | $k(r-1)+1$ |
| Derangements | $D_n=n!\sum_{k=0}^n(-1)^k/k!$ |
| Derangement Recurrence | $D_n=(n-1)(D_{n-1}+D_{n-2})$ |
| Handshake Lemma | $\sum\deg(v)=2E$ |
| Pairwise Connections | $E=\binom n2$ |
| Maximum Line Intersections | $\binom n2$ |
| Circle Chord Intersections | $\binom n4$ |

Counting formulas must be used with the corresponding assumptions about order, repetition, whether objects are distinguishable, and any other restrictions.

### 6. Probability and Statistics

| Formula Name | Formula |
| --- | --- |
| Classical Probability | $P(A)=N(A)/N(S)$ |
| Complement | $P(A^c)=1-P(A)$ |
| Addition Rule | $P(A\cup B)=P(A)+P(B)-P(A\cap B)$ |
| Multiplication Rule | $P(A\cap B)=P(A)P(B\mid A)$ |
| Independent Events | $P(A\cap B)=P(A)P(B)$ |
| Conditional Probability | $P(A\mid B)=P(A\cap B)/P(B)$ |
| Binomial Probability | $P(X=k)=\binom nk p^k(1-p)^{n-k}$ |
| Hypergeometric Probability | $P(X=k)=\frac{\binom Kk\binom{N-K}{n-k}}{\binom Nn}$ |
| Expected Value | $E(X)=\sum x_iP(X=x_i)$ |
| Linearity of Expectation | $E(X+Y)=E(X)+E(Y)$ |
| Geometric Probability | $P=\text{Favourable measure}/\text{Total measure}$ |
| Range | $R=x_{\max}-x_{\min}$ |

### 7. Triangle Geometry

| Formula Name | Formula |
| --- | --- |
| Angle Sum | $A+B+C=180^\circ$ |
| Exterior Angle | $\theta_{\rm ext}=A+B$ |
| Triangle Inequality | $\lvert a-b \rvert<c<a+b$ |
| Pythagorean Theorem | $a^2+b^2=c^2$ |
| 45°–45°–90° | $1:1:\sqrt2$ |
| 30°–60°–90° | $1:\sqrt3:2$ |
| Triangle Area | $S=\frac12bh$ |
| Equilateral Height | $h=\frac{\sqrt3}{2}a$ |
| Equilateral Area | $S=\frac{\sqrt3}{4}a^2$ |
| Heron's Formula | $S=\sqrt{s(s-a)(s-b)(s-c)}$ |
| Semiperimeter | $s=\frac{a+b+c}{2}$ |
| Similar Triangle Area Ratio | $S_1/S_2=k^2$ |
| Angle Bisector Theorem | $BD/DC=AB/AC$ |
| Centroid Ratio | $AG/GD=2$ |
| Inradius | $r=S/s$ |
| Circumradius | $R=abc/(4S)$ |
| Right Triangle Circumradius | $R=c/2$ |
| Altitude to Hypotenuse | $h^2=mn$ |
| Leg Projection | $a^2=cm,\quad b^2=cn$ |
| Sine Rule | $a/\sin A=b/\sin B=c/\sin C$ |
| Cosine Rule | $a^2=b^2+c^2-2bc\cos A$ |
| Sine Area | $S=\frac12bc\sin A$ |

### 8. Polygons and Circles

| Formula Name | Formula |
| --- | --- |
| Rectangle Area | $S=lw$ |
| Square Area | $S=a^2$ |
| Square Diagonal | $d=a\sqrt2$ |
| Parallelogram Area | $S=bh$ |
| Trapezoid Area | $S=\frac12(a+b)h$ |
| Rhombus Area | $S=\frac12d_1d_2$ |
| Polygon Interior Angle Sum | $(n-2)180^\circ$ |
| Regular Polygon Interior Angle | $\frac{(n-2)180^\circ}{n}$ |
| Regular Polygon Exterior Angle | $360^\circ/n$ |
| Polygon Diagonals | $n(n-3)/2$ |
| Regular Polygon Area | $S=\frac12Pa$ |
| Regular Hexagon Area | $S=\frac{3\sqrt3}{2}a^2$ |
| Circumference | $C=2\pi r$ |
| Circle Area | $S=\pi r^2$ |
| Arc Length | $L=\frac{\theta}{360^\circ}2\pi r$ |
| Sector Area | $S=\frac{\theta}{360^\circ}\pi r^2$ |
| Annulus Area | $S=\pi(R^2-r^2)$ |
| Inscribed Angle | $\theta_{\rm inscribed}=\theta_{\rm central}/2$ |
| Cyclic Quadrilateral | $A+C=B+D=180^\circ$ |
| Equal Tangents | $PA=PB$ |
| Chord Length | $L=2\sqrt{r^2-d^2}$ |
| Intersecting Chords | $PA\cdot PB=PC\cdot PD$ |
| Tangent–Secant | $PT^2=PA\cdot PB$ |
| Interior Chord Angle | $\theta=(\alpha+\beta)/2$ |
| Exterior Secant Angle | $\theta=(\alpha-\beta)/2$ |

### 9. Coordinate Geometry

| Formula Name | Formula |
| --- | --- |
| Distance | $d=\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}$ |
| Midpoint | $M=(\frac{x_1+x_2}2,\frac{y_1+y_2}2)$ |
| Slope | $m=\frac{y_2-y_1}{x_2-x_1}$ |
| Slope–Intercept | $y=mx+c$ |
| Point–Slope | $y-y_1=m(x-x_1)$ |
| Parallel Lines | $m_1=m_2$ |
| Perpendicular Lines | $m_1m_2=-1$ |
| Coordinate Triangle Area | $\frac12\lvert x_1(y_2-y_3)+x_2(y_3-y_1)+x_3(y_1-y_2) \rvert$ |
| Shoelace Formula | $\frac12\lvert \sum x_iy_{i+1}-\sum y_ix_{i+1} \rvert$ |
| Pick's Theorem | $S=I+B/2-1$ |
| Rotation 90° CCW | $(x,y)\to(-y,x)$ |
| Rotation 90° CW | $(x,y)\to(y,-x)$ |
| Rotation 180° | $(x,y)\to(-x,-y)$ |
| Reflection in x-axis | $(x,y)\to(x,-y)$ |
| Reflection in y-axis | $(x,y)\to(-x,y)$ |

The parallel and perpendicular slope formulas require the relevant slopes to exist; vertical lines must be handled separately.

### 10. Solid Geometry

| Formula Name | Formula |
| --- | --- |
| Cube Volume | $V=a^3$ |
| Cube Surface Area | $S=6a^2$ |
| Cube Space Diagonal | $d=a\sqrt3$ |
| Rectangular Prism Volume | $V=lwh$ |
| Rectangular Prism Surface Area | $S=2(lw+lh+wh)$ |
| Rectangular Prism Diagonal | $d=\sqrt{l^2+w^2+h^2}$ |
| Prism Volume | $V=S_{\rm base}h$ |
| Pyramid Volume | $V=\frac13S_{\rm base}h$ |
| Cylinder Volume | $V=\pi r^2h$ |
| Cylinder Total Surface Area | $S=2\pi r^2+2\pi rh$ |
| Cone Volume | $V=\frac13\pi r^2h$ |
| Right Cone Slant Height | $l=\sqrt{r^2+h^2}$ |
| Cone Lateral Area | $S=\pi rl$ |
| Sphere Volume | $V=\frac43\pi r^3$ |
| Sphere Surface Area | $S=4\pi r^2$ |
| Similar Solid Surface Ratio | $S_1/S_2=k^2$ |
| Similar Solid Volume Ratio | $V_1/V_2=k^3$ |
| Euler's Polyhedron Formula | $V-E+F=2$ |

### 11. Additional Formulae

| Formula Name | Formula |
| --- | --- |
| Even Integer | $2k$ |
| Odd Integer | $2k+1$ |
| Consecutive Integers | $n,n+1,\ldots,n+k-1$ |
| Sum of Consecutive Integers | $\frac{k(2n+k-1)}2$ |
| Symmetric Square Sum | $a^2+b^2=(a+b)^2-2ab$ |
| Symmetric Cube Sum | $a^3+b^3=(a+b)^3-3ab(a+b)$ |
| Difference of Roots Squared | $(a-b)^2=(a+b)^2-4ab$ |
| Invariant Modulo m | $N_{\rm new}\equiv N_{\rm old}\pmod m$ |
| Clock Hour Hand | $\theta_h=30h+0.5m$ |
| Clock Minute Hand | $\theta_m=6m$ |
| Clock Smallest Angle | $\theta=\min(\Delta,360^\circ-\Delta)$, $\Delta=\lvert 30h-5.5m \rvert$ |
| Double Counting | $\text{Count A}=\text{Count B}$ |

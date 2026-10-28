---
id: n-study-ellison-io
title: "Ellison IO Lecture Notes"
type: note
category: self-study
kind: notes
date: ""
status: ""
authors: ""
year: ""
venue: ""
url: ""
label: ""
---

# Ellison IO Lecture Notes

## Contents

- Single Product Monopoly Pricing
- Monopoly and Product Quality
- Multiple Product Monopoly Pricing

Self-study notes. L01: Monopoly Pricing & Durable Goods, I — Glenn Ellison.

## Single Product Monopoly Pricing

$$\max_{x} P(x)x - C(x)$$

FOC:

$$\underbrace{P(x) + P'(x) \cdot x}_{MR} - C'(x) = 0$$

$$\Rightarrow \frac{P(x) - C'(x)}{P(x)} = -\frac{1}{\varepsilon}$$

where $\varepsilon$ is the price elasticity of demand at $p$, $\varepsilon = \frac{dx}{dp} \cdot \frac{p}{x}$.

**Lerner Index:** $\frac{P(x) - C'(x)}{P(x)}$ — the % of the product's price that is marked up above its marginal cost of production. A firm's ability to charge prices higher than what it costs to produce an additional unit without losing all its customers.

1) Never $|\varepsilon| < 1$: if $|\varepsilon| < 1$, then $-1/\varepsilon > 1$, but $(P - MC)/P$ will never exceed 1.

2) $\varepsilon = -100$, $|\varepsilon|$ big $\Rightarrow -1/\varepsilon = 1/100 \Rightarrow P \approx MC$.

## Monopoly and Product Quality

Quality $s \in \mathbb{R}$. Cost: $C(q, s) = q \cdot C(s)$.

Consumer preference $\theta \sim U[0, 1]$ (uniformly distributed).

If the firm sells $q$ units, it will sell to consumers with $\theta \in [1-q, 1]$. The indifferent consumer has $\theta = 1 - q$, for whom $p = v(s, 1-q)$.

Monopolist's problem:

$$\max_{q, s} q[v(s, 1-q) - C(s)]$$

FOC (with respect to quality):

$$\frac{\partial v}{\partial s}(s^m, 1-q^m) = \frac{\partial C}{\partial s}(s^m)$$

The effect of marginal cost spent is the benefit to the *marginal consumer*.

Social planner's problem:

$$\max_{q, s} \int_{1-q}^{1} (v(s, \theta) - C(s)) \, d\theta$$

FOC:

$$\frac{1}{q}\int_{1-q}^{1} \frac{\partial v}{\partial s}(s, \theta) \, d\theta = \frac{\partial C}{\partial s}(s)$$

The effect is the benefit to the *average consumer*.

## Multiple Product Monopoly Pricing

Demands $x_1(p_1, p_2)$, $x_2(p_1, p_2)$. Cost: $C(x_1, x_2) = c_1 x_1 + c_2 x_2$.

Monopolist's problem:

$$\max_{p_1, p_2} (p_1 - c_1)x_1(p_1, p_2) + (p_2 - c_2)x_2(p_1, p_2)$$

FOC:

$$(p_i - c_i)\frac{\partial x_i}{\partial p_i} + x_i(p_1, p_2) + (p_j - c_j)\frac{\partial x_j}{\partial p_i} = 0$$

Dividing by $\partial x_i / \partial p_i$:

$$(p_i - c_i) + \frac{x_i(p_1, p_2)}{\partial x_i / \partial p_i} + (p_j - c_j)\frac{\partial x_j / \partial p_i}{\partial x_i / \partial p_i} = 0$$

Markup formula:

$$\frac{p_i - c_i}{p_i} = -\frac{1}{\varepsilon_{ii}} - \frac{p_j - c_j}{p_i \cdot \partial x_i / \partial p_i} \cdot \frac{\partial x_j}{\partial p_i}$$

with $(p_j - c_j) > 0$, and $\partial x_j / \partial p_i > 0$ for substitutes, $< 0$ for complements.

Example noted on the page: newspapers and ads — ① the newspaper sells more; ② the ads are largely profitable.

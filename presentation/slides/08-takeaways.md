## Key Takeaways

1. H3 multiplexing removes the per-request penalty at small-to-medium chunk sizes
2. The crossover point depends on network conditions — loss amplifies H3's advantage
3. Edge caching + H3 is the sweet spot: no origin round trips, full multiplexing
4. Cache invalidation erodes the H3 advantage proportionally to stale ratio
5. **Implication:** With H3 adoption, fine-grained splitting becomes viable — enabling better caching, smaller invalidation blast radius, and faster incremental updates

---

## Thank You

Data & source: [github.com/moonmeister/request-tax](https://github.com/moonmeister/request-tax)

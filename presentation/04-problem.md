## Why do we bundle?

---

## We bundle because...

We **bundle** JavaScript, CSS, and images into large files because HTTP/1.1 punishes many requests:

- Head-of-line blocking per connection <!-- .element: class="fragment" -->
- 6 parallel connections per origin <!-- .element: class="fragment" -->
- Header Overhead <!-- .element: class="fragment" -->
- TCP + TLS handshake per connection <!-- .element: class="fragment" -->
- TCP Slow Start <!-- .element: class="fragment" -->

---

## ...HTTP/1.1 told us to!

<br />

![Braveheart freedom meme except it says "Bundle!"](./assets/bundle.jpg)

Note:

- Not js JS/CSS
- Image sprites
- inline CSS
- Ecosystems: Gulp, Webpack, Rollup, Vite, etc...

---

Data, Please!

<iframe src="../results/charts/phase-1-scaling.html?show=h1" style="width:100%;height:500px;border:none;"></iframe>

---

## What about caching?

<div style="display:flex;align-items:center;gap:2em;">

<ul>
    <li class="fragment">A single changed line invalidates the <strong>entire</strong> bundle</li>
    <li class="fragment">Users re-download kilobytes for bytes of changes</li>
    <li class="fragment">Cache hit rates drop as bundle size grows</li>
    <li class="fragment">Code-splitting helps, but chunking strategy is still a guessing game</li>
</ul>

<img src="./assets/stopbundling.jpg" alt="I'm once again asking you to stop bundling" style="max-height:600px;" />

</div>

---

## Summary

<br />

- **TCP + HTTP/1.1** gain performance from bundling
- **Document Caching** gains performance from granularity

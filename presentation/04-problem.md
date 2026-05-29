## Why do we bundle?

---

## We bundle because...

- Head-of-line blocking per connection <!-- .element: class="fragment" -->
- 6 parallel connections per origin <!-- .element: class="fragment" -->
- Header Overhead <!-- .element: class="fragment" -->
- TCP + TLS handshake per connection <!-- .element: class="fragment" -->
- TCP Slow Start per connection <!-- .element: class="fragment" -->

---

## ...HTTP/1.1 told us to!

<br />

![Braveheart freedom meme except it says "Bundle!"](./assets/bundle.jpg)

---

## What about caching?

<div style="display:flex;align-items:center;gap:2em;">

<ul>
    <li class="fragment">A single changed line invalidates the <strong>entire</strong> bundle</li>
    <li class="fragment">Users re-download kilobytes for bytes of changes</li>
    <li class="fragment">Cache hit rates drop as bundle grows</li>
</ul>

<img src="./assets/stopbundling.jpg" alt="I'm once again asking you to stop bundling" style="max-height:600px;" />

</div>

---

## Summary

<br />

- **TCP + HTTP/1.1** gain performance from bundling
- **Document Caching** gains performance from granularity
- **Code Splitting** is our way of finding balance

---

## Challenges

- Network will always be slower than no network <!-- .element: class="fragment" -->
- Caching reduces network <!-- .element: class="fragment" -->
- How to we push optimization towards better caching? <!-- .element: class="fragment" -->

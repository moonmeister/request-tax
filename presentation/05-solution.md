## Can we fix this?

**HTTP/2 (SPDY)**

<div style="display:flex;align-items:flex-start;gap:3em;">
<div>
<h4>✅ Fixed</h4>
<ul>
<li class="fragment">Parallel requests (aka Multiplexing via frames)</li>
<li class="fragment">Header compression (HPACK)</li>
<li class="fragment">Single TCP connection per origin</li>
</ul>
</div>
<div>
<h4>❌ Still broken</h4>
<ul>
<li class="fragment">TCP head-of-line blocking</li>
<li class="fragment">TCP slow start after idle</li>
<li class="fragment">TLS handshake latency</li>
</ul>
</div>
</div>

---

## We did fix this!

**HTTP/3 over QUIC**

<ul>
<li class="fragment">✅ Parallel requests (multiplexing via frames)</li>
<li class="fragment">✅ Header compression (QPACK)</li>
<li class="fragment">✅ Single connection per origin</li>
<li class="fragment">✅ No TCP head-of-line blocking (independent streams)</li>
<li class="fragment">✅ No TCP slow start penalty (0-RTT resumption)</li>
<li class="fragment">✅ Faster handshake (TLS 1.3 built into QUIC)</li>
<li class="fragment">✅ Connection migration (survives network changes)</li>
</ul>

---

## Did we fix this?

<br />

**Let's look at the data...**

![Data on the bride](./assets/data.png) <!-- .element: class="fragment" -->

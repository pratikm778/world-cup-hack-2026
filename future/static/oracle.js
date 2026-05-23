const topBetsForm = document.querySelector("#top-bets-form");
const trace = document.querySelector("#trace");
const rankings = document.querySelector("#rankings");

function setTopBetsBusy(isBusy) {
  topBetsForm.querySelector("button").disabled = isBusy;
  topBetsForm.querySelector("button").textContent = isBusy ? "Ranking..." : "Rank live bets";
}

function appendText(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

function appendLink(parent, text, href, className) {
  if (!href) return null;
  const link = document.createElement("a");
  if (className) link.className = className;
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = text;
  parent.appendChild(link);
  return link;
}

function bulletList(items) {
  const list = document.createElement("ul");
  list.className = "bullet-list";
  (items || []).filter(Boolean).forEach((text) => {
    appendText(list, "li", text);
  });
  return list;
}

function candidateKey(candidate) {
  return `${candidate.question || ""}::${candidate.event_title || ""}`;
}

topBetsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setTopBetsBusy(true);
  rankings.textContent = "Fetching live Polymarket markets, enriching with Exa, then ranking...";
  trace.textContent = "Live ranking in progress...";

  try {
    const response = await fetch("/api/top-bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: topBetsForm.theme.value, limit: 10 }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "ranking failed");
    }

    const candidatesByKey = new Map((data.candidates || []).map((candidate) => [candidateKey(candidate), candidate]));
    rankings.innerHTML = "";
    data.reasoning.rankings.forEach((item) => {
      const candidate = candidatesByKey.get(candidateKey(item)) || {};
      const sources = candidate.insight?.sources || [];
      const row = document.createElement("div");
      row.className = "ranking-row";

      appendText(row, "strong", `#${item.rank}`);

      const details = document.createElement("div");
      details.className = "ranking-detail";
      appendText(details, "strong", item.question || "Untitled market");

      const meta = document.createElement("div");
      meta.className = "ranking-meta";
      appendText(meta, "span", `${item.recommendation || "watch"} ${item.side ? `on ${item.side}` : ""} at ${item.price ?? candidate.yes_price ?? "n/a"}`);
      appendLink(meta, "Open Polymarket", candidate.url || candidate.event_url, "market-link");
      details.appendChild(meta);

      const reasonBullets = item.reason_bullets?.length ? item.reason_bullets : [item.reason].filter(Boolean);
      if (reasonBullets.length) {
        appendText(details, "small", "Reasoning");
        details.appendChild(bulletList(reasonBullets));
      }

      const riskBullets = item.risk_bullets?.length ? item.risk_bullets : [item.risk].filter(Boolean);
      if (riskBullets.length) {
        appendText(details, "small", "Risks");
        details.appendChild(bulletList(riskBullets));
      }

      if (sources.length) {
        const sourceWrap = document.createElement("div");
        sourceWrap.className = "source-links";
        appendText(sourceWrap, "small", "Exa sources");
        sources.slice(0, 4).forEach((source) => {
          appendLink(sourceWrap, source.title || source.url || "Source", source.url, "source-link");
        });
        details.appendChild(sourceWrap);
      }

      row.appendChild(details);
      appendText(row, "div", item.score ?? "--", "ranking-score");
      rankings.appendChild(row);
    });

    trace.textContent = JSON.stringify(
      {
        theme: data.theme,
        latency_seconds: data.latency_seconds,
        reasoning_provider: data.reasoning.provider,
        model: data.reasoning.model,
        transport: data.reasoning.transport || null,
        rocketride_gmi_error: data.reasoning.rocketride_gmi_error || null,
        note: data.reasoning.note || data.reasoning.error || null,
      },
      null,
      2,
    );
  } catch (error) {
    rankings.textContent = "Ranking failed.";
    trace.textContent = error.message;
  } finally {
    setTopBetsBusy(false);
  }
});

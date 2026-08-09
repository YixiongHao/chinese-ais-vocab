# Research brief — shared by all vocabulary research agents

You are filling in one category of a bilingual EN↔ZH AI-safety terminology database.
Read `SCHEMA.md` in the project root first; it defines every field and is binding.

## The problem you are solving

Much of the vocabulary English-language AI safety uses — especially around existential
risk, loss of control, and misalignment — has no settled Chinese rendering. Some has
several competing renderings. Some has an established rendering that quietly distorts the
concept. Your job is to find out **which of these three situations each term is in**, and
say so, with evidence.

The most valuable output is not a translation. It is an accurate picture of the state of
the Chinese-language terminology, including where it doesn't exist.

## Where to look

Search in Chinese, not English. Search for the concept, not just the term — sometimes the
Chinese discourse discusses an idea without a fixed name for it.

**High value:**
- 安远 AI / Concordia AI (concordia-ai.com, 安远AI 公众号) — bilingual reports, the single
  best cross-reference source; their EN and ZH reports often cover the same content.
- 知乎 (zhihu.com) — long-form ML explainers, often where terminology first stabilises.
- 机器之心 (jiqizhixin.com), 量子位 (qbitai.com), 新智元 — paper coverage; they translate
  new terms as papers land, and their choice often sticks.
- Chinese README / 中文文档 of major GitHub repos (transformers, vllm, TransformerLens,
  SAELens, OpenRLHF, LLaMA-Factory, trl…).
- 智源 BAAI, 上海人工智能实验室 (Shanghai AI Lab), 清华 THU / 北大 / 复旦 lab pages and
  Chinese-language papers and 技术报告.
- Chinese lab model cards and tech reports: DeepSeek, Qwen/通义, Zhipu/智谱, Moonshot/月之暗面,
  MiniMax, StepFun/阶跃星辰 — especially their 安全 sections.
- Government / standards: 全国网络安全标准化技术委员会 (TC260) 《人工智能安全治理框架》,
  中国信通院 (CAICT) white papers, 《全球人工智能治理倡议》, 国家人工智能标准化总体组.
  These are authoritative for policy vocabulary specifically.
- Podcasts/transcripts: 张小珺商业访谈录, 硅谷 101, OnBoard!, 42章经 — practitioners speaking
  naturally, which reveals what people actually *say* vs. what gets written.
- 微信公众号 posts by researchers, bilibili technical talks, 少数派.
- Wikipedia 中文 and 百度百科 for established concepts (weak evidence alone; corroborate).

**Cross-reference trick:** when an org publishes the same document in English and Chinese
(Concordia AI, the International AI Safety Report, OECD/UN material, lab model cards),
line the two up. That gives you a genuine attested translation pair, which is the strongest
evidence available. Prefer these.

## Evidence rules

- Every non-`proposed` translation should carry ≥1 attestation with a **verbatim** Chinese
  quote and a real URL you actually fetched.
- **Never fabricate a quote, URL, publisher, or date.** If you can't recover the sentence
  verbatim, drop the attestation and lower `confidence`. An honest `low` is worth more than
  a fake `high`. This is the one thing that would make the database worthless.
- If nothing exists, that's a finding: set `status: "proposed"`, put your reasoning in
  `notes`, set `translation_difficulty: "high"`, and explain in `pitfalls` why the term
  resists translation.
- Record loanwords honestly. If Chinese practitioners write "SAE" or "scaling law" in Latin
  letters mid-sentence, that is the real answer — record it as `status: "loanword"` and
  note any Chinese rendering as a secondary entry.

## Things worth flagging in `pitfalls`

These recur; watch for them:
- 安全 collapses **safety** and **security** into one word. Nearly every governance term is
  affected. Note when a Chinese source's 安全 means one, the other, or is ambiguous.
- 对齐 for *alignment* is established but reads as mechanical/geometric to a lay reader.
- 治理 (governance) vs 管理 (management/administration) vs 监管 (regulation) carry different
  political weight.
- 智能体 vs 代理 vs 智能代理 for *agent*; 代理 also means "proxy/agency".
- 风险 vs 隐患 vs 威胁 for risk framings.
- Terms where the PRC policy register has a *different* established word than the ML
  research register. Record both, and say which community uses which.

## Output

Write **one JSON file** to the exact path given in your task, containing a JSON array of
term objects conforming to `SCHEMA.md`. Nothing else in the file — no markdown fence, no
prose wrapper. Valid UTF-8, valid JSON, `"` quotes, no trailing commas.

Your final chat message should be a short summary only (≤10 lines): count of terms written,
which ones had no Chinese equivalent at all, which had contested renderings, and anything
surprising. Do not paste the JSON into chat.

You may add terms to your category that the seed list missed, if they are clearly in scope
— cap additions at 5 and mark them with `"tags": ["added-by-research", …]`.

Budget your effort: aim for real attestations on the 60% of terms that matter most, and
don't burn the whole budget on one stubborn term. Note gaps rather than chasing them.

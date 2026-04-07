#!/usr/bin/env python3
"""
THE BRIDGE — 100 Patient Reviews of bridge-patient.html
=========================================================
Uses the Claude Batches API (50% cost) to run all 100 testing agents
through the real bridge-patient.html interface in parallel.

Usage:
  python3 run-100-reviews.py                      # Submit batch & poll until done
  python3 run-100-reviews.py --submit-only        # Submit batch, print batch ID, exit
  python3 run-100-reviews.py --retrieve BATCH_ID  # Retrieve results from prior batch
  python3 run-100-reviews.py --from-json FILE     # Re-analyze a saved results JSON

Output files (auto-named with timestamp):
  bridge_reviews_YYYYMMDD_HHMMSS.json     — raw structured results
  bridge_reviews_YYYYMMDD_HHMMSS.md       — readable report with all 100 reviews
  bridge_reviews_summary_YYYYMMDD.md      — segment-level analysis
"""

import json
import os
import sys
import time
import re
from datetime import datetime
from importlib.util import spec_from_file_location, module_from_spec
from pathlib import Path

import anthropic

# ============================================================
# CONFIG
# ============================================================

MODEL = "claude-opus-4-6"
MAX_TOKENS = 1200          # Per review — enough for a rich qualitative response
POLL_INTERVAL = 30         # seconds between batch status checks
SCRIPT_DIR = Path(__file__).parent
AGENTS_FILE = SCRIPT_DIR / "100-testing-agents-(seniors-patients).py"
TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")

# ============================================================
# LOAD AGENT GENERATOR
# ============================================================

def load_agents():
    spec = spec_from_file_location("testing_agents", AGENTS_FILE)
    m = module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.generate_all_agents(100)


# ============================================================
# BRIDGE-PATIENT.HTML SCREEN DESCRIPTION
# This is the authoritative description of what the app shows.
# Extracted from the real HTML — updated whenever the UI changes.
# ============================================================

BRIDGE_PATIENT_SCREEN = """
THE BRIDGE — Patient App (bridge-patient.html)
====================================================
You are looking at a smartphone app screen for a senior patient at Seoul Medical Group.
The app is called "The Bridge." It is a health companion app for Korean-American seniors.

LANGUAGE TOGGLE: Top-right corner shows "EN | 한국어" — you can tap to switch to Korean.

──────────────────────────────
TAB 1: HOME (default screen)
──────────────────────────────

HEALTH SCORE HERO (top):
  "Good morning, Susan. You're doing well today ✓"
  Name: Susan Kim · Koreatown, LA · March 17
  Conditions: Type 2 Diabetes · Hypertension · Osteoarthritis
  Primary Care: Dr. James Park
  [Open My Health] button

MY INSURANCE card:
  Status badge: ✓ ACTIVE (green)
  Plan: LA Care Medicare Advantage
  Member ID: MCA-7842-9301
  PRIMARY CARE: SMG Koreatown
  COVERAGE DATES: Jan – Dec 2026 · Verified ✓

APPROVAL REQUESTS card (2 requests):
  1. MRI — Left Knee · Referred by Dr. Park · Mar 12
     "⏳ Insurance is reviewing. Usually 3–5 business days."
     Status badge: Pending (amber/yellow)

  2. Colonoscopy — Specialist · Referred by Dr. Park · Mar 5
     "✓ Approved! Your plan covers this. Schedule with Jiyeon."
     Status badge: Approved (green)

OVERDUE SCREENING alert (amber):
  "Colonoscopy — 8 months overdue"
  [Schedule Now] button

BILL NOTICE card (red accent):
  "Bill: $90.00 Due"
  "March 14 specialist visit · Due April 14"
  Expandable explanation: "Your insurance paid $1,240 for this visit.
   The $90 is your copayment — a small portion you pay for specialist visits.
   This is completely normal."
  Buttons: [Pay $90 Now]  [Ask Jiyeon]

TODAY'S REMINDERS:
  • Metformin 500mg — "Take with lunch · Refill in 16 days" (amber: Soon)
  • Lisinopril 10mg — "Take with dinner · 28 days remaining" (green: OK)

NEXT APPOINTMENT:
  Thursday, March 27
  Primary Care Visit · 10:30 AM · SMG Koreatown Clinic
  Buttons: [Book a Ride]  [Add to Calendar]

QUICK ACTIONS (4 buttons):
  💬 Message Jiyeon — "Your care handler · Korean-English"
  📅 Schedule a Visit — "Primary care, specialist, or lab work"
  🚗 Book a Ride — "Free medical transport covered by your plan"
  🏥 Find Urgent Care — "Nearby · Open now · Covered by your plan"

MESSAGE FROM JIYEON (bottom of home tab):
  From: Jiyeon Choi, Care Handler · Today 8:45 AM
  "Good morning, Susan! Don't forget to take your Metformin with lunch today.
   Your appointment with Dr. Park is this Thursday at 10:30 AM.
   Would you like me to arrange a ride? 😊"
  [Reply to Jiyeon] input box

──────────────────────────────
TAB 2: HEALTH
──────────────────────────────
  Susan Kim, 76 — "Doing Well"
  "Your health score is strong. Keep taking your medications and attending appointments."

  CARE GAPS (3 care gaps — amber warning):
    1. Colonoscopy Screening — Overdue by 8 months (amber: Overdue)
       "Recommended every 10 years for your age. Detects colon cancer early."
       [Schedule This Screening]
    2. Mammogram — Overdue by 14 months
       "Recommended annually for women your age."
    3. Diabetic Eye Exam — Due this year (blue)
       "Annual for diabetes management. Important for your eyes."

  MEDICATIONS (4 active):
    Metformin 500mg — 2x daily — 53% supply bar
    Lisinopril 10mg — 1x daily — 87% supply bar

  RECENT LABS:
    Hemoglobin A1c: 6.9% · Mar 15 · On Target (green)
    Blood Pressure: 128/82 · Mar 15 · Watch (amber)
    eGFR (Kidney): 71 mL/min · Mar 15 · Normal (green)

──────────────────────────────
TAB 3: BENEFITS
──────────────────────────────
  Plan: LA Care Medicare Advantage · ACTIVE (green)
  Member ID: MCA-7842-9301 · Group: SMG-KT-2026
  In-network PCP: Dr. James Park — SMG Koreatown
  Dental coverage details (expandable)
  Vision coverage details (expandable)
  Transportation benefit: Up to 32 free rides/year

──────────────────────────────
TAB 4: CHAT (Jiyeon AI)
──────────────────────────────
  Full chat interface with Jiyeon Choi (AI care handler)
  Bilingual — responds in Korean or English
  Suggested quick replies: "What's my copay?", "Do I need a referral?",
    "Schedule my mammogram", "Find urgent care near me"
  Example exchange visible:
    Susan: "지연아 내 보험이 이 MRI를 커버해?"
    Jiyeon: "안녕하세요 Susan! 네, LA Care Medicare Advantage 플랜이 MRI를 커버합니다..."
====================================================
"""

# ============================================================
# REVIEW PROMPT GENERATOR
# ============================================================

TESTING_OBJECTIVES_SYSTEM = """You are a UX researcher conducting a qualitative usability study
for a health technology company serving Korean-American senior patients.

You will be given a patient profile (a digital twin of a real SMG patient) and a description
of the Bridge app's patient interface. Your job is to role-play as that patient and provide
a realistic, in-character review — like a real interview transcript.

Be brutally honest. Real seniors are skeptical, confused, proud, and protective of their privacy.
Do NOT write marketing copy or be artificially positive. If this person would be confused, show
that confusion. If they'd be suspicious, show that. If they'd love it, show that too.

Structure your response as a realistic interview. Use the person's actual voice."""


def build_review_prompt(agent: dict) -> str:
    profile = json.dumps(agent, indent=2)
    is_korean = agent["demographics"]["ethnicity"] == "Korean"
    eng = agent["demographics"]["english_proficiency"]
    dig_lit = agent["behavioral"]["digital_literacy"]
    age = agent["demographics"]["age"]

    language_note = ""
    if is_korean and eng in ("none", "minimal"):
        language_note = "IMPORTANT: This person speaks almost no English. They would respond in Korean with very occasional English words. Represent this authentically — write their responses in a mix of romanized Korean expressions and broken English, or Korean script where appropriate.\n"
    elif is_korean and eng == "limited":
        language_note = "IMPORTANT: This person has limited English. They may mix Korean phrases naturally into their response.\n"

    dig_note = ""
    if dig_lit == "very_low":
        dig_note = "IMPORTANT: This person has very low digital literacy. They likely cannot operate a smartphone independently. Show their confusion with technology concepts vividly.\n"
    elif dig_lit == "low":
        dig_note = "IMPORTANT: This person has low digital literacy. Technology confuses them. Show this realistically.\n"

    return f"""{language_note}{dig_note}

YOU ARE: {agent['name']}
AGE: {age} | ETHNICITY: {agent['demographics']['ethnicity']} | ENGLISH: {eng} | DIGITAL LITERACY: {dig_lit}
LIVES: {'Alone' if agent['living_situation']['lives_alone'] else 'With family/spouse'} | CITY: {agent['demographics']['city']}
ISOLATION RISK: {agent['living_situation']['social_isolation_risk']}
HEALTH: {', '.join(agent['clinical']['chronic_conditions'])} | CARE GAPS: {len(agent['clinical']['care_gaps'])}
FAMILY: {agent['family']['children_count']} children | Distant child: {agent['family']['has_distant_child']}
DIGITAL TRUST: {agent['behavioral']['trust_in_technology']} | SHARE WILLINGNESS: {agent['behavioral']['willingness_to_share_health_data']}
PREDICTED DROP-OFF: {agent['app_predictions']['primary_dropoff_point']}

YOUR FULL PROFILE:
{profile}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE APP YOU ARE REVIEWING:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{BRIDGE_PATIENT_SCREEN}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR REVIEW (respond IN CHARACTER as {agent['name']}):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Answer these questions AS THIS PERSON — in their real voice, at their real level of understanding:

1. FIRST IMPRESSION: What do you see when you first look at this? What do you think this app is for?

2. USABILITY: Walk through what you'd actually try to tap or read. What's easy? What confuses you?
   Is there anything you genuinely cannot figure out?

3. THE INSURANCE CARD & BILL: How do you feel seeing your insurance status and the $90 bill
   right there on the screen? Is this helpful or overwhelming?

4. JIYEON: What do you think of having an AI named Jiyeon as your "care handler"?
   Would you actually message her? What would you say first?

5. SHARING WITH FAMILY: If your children could also see this same information about you,
   how do you feel about that? Comfortable? Proud? Worried?

6. WOULD YOU KEEP IT?: Honestly — after one week, would you still be using this app? Why or why not?
   What would make you delete it?

7. THE ONE THING: What is the single feature that actually speaks to YOUR life right now?

Respond as {agent['name']} would really talk. Make it feel like a real interview, not a survey."""


# ============================================================
# BATCH SUBMISSION
# ============================================================

def submit_batch(agents: list, client: anthropic.Anthropic) -> str:
    """Submit all 100 review prompts as a single batch."""
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    requests = []
    for agent in agents:
        prompt = build_review_prompt(agent)
        req = Request(
            custom_id=agent["id"],
            params=MessageCreateParamsNonStreaming(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=TESTING_OBJECTIVES_SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            ),
        )
        requests.append(req)

    # Split into two batches of 50 to avoid large-payload connection drops
    batch_ids = []
    for chunk_start in range(0, len(requests), 50):
        chunk = requests[chunk_start:chunk_start + 50]
        label = f"A (1–50)" if chunk_start == 0 else f"B (51–100)"
        print(f"  Submitting batch {label} — {len(chunk)} requests...")
        batch = client.messages.batches.create(requests=chunk)
        batch_ids.append(batch.id)
        print(f"  ✓ Batch {label} submitted: {batch.id}")
        time.sleep(2)  # small pause between submissions

    # Return as comma-joined string so poll/collect can handle both
    return ",".join(batch_ids)


# ============================================================
# BATCH POLLING
# ============================================================

def poll_until_complete(batch_ids_str: str, client: anthropic.Anthropic):
    """Poll one or more batches until all finish."""
    ids = [b.strip() for b in batch_ids_str.split(",")]
    print(f"\n  Polling {len(ids)} batch(es)...")
    while True:
        all_done = True
        total_succ = total_err = total_proc = 0
        for bid in ids:
            batch = client.messages.batches.retrieve(bid)
            counts = batch.request_counts
            total_succ += counts.succeeded
            total_err += counts.errored
            total_proc += counts.processing
            if batch.processing_status != "ended":
                all_done = False
        total = total_succ + total_err + total_proc
        pct = ((total_succ + total_err) / total * 100) if total > 0 else 0
        bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
        print(f"  [{bar}] {pct:.0f}%  ✓{total_succ} ✗{total_err} ⏳{total_proc}    ", end="\r")
        if all_done:
            print(f"\n  ✓ All batches complete — {total_succ} succeeded, {total_err} errors")
            return
        time.sleep(POLL_INTERVAL)


# ============================================================
# RESULT COLLECTION
# ============================================================

def collect_results(batch_ids_str: str, agents: list, client: anthropic.Anthropic) -> list:
    """Collect all results from one or more batches and merge with agent profiles."""
    ids = [b.strip() for b in batch_ids_str.split(",")]
    agent_map = {a["id"]: a for a in agents}

    results = []
    for batch_id in ids:
        for result in client.messages.batches.results(batch_id):
            agent = agent_map.get(result.custom_id, {})
            entry = {
                "agent_id": result.custom_id,
                "agent_name": agent.get("name", "Unknown"),
                "agent_demographics": agent.get("demographics", {}),
                "agent_behavioral": agent.get("behavioral", {}),
                "agent_clinical": agent.get("clinical", {}),
                "agent_living": agent.get("living_situation", {}),
                "agent_family": agent.get("family", {}),
                "app_predictions": agent.get("app_predictions", {}),
                "emotional_profile": agent.get("emotional_profile", {}),
                "status": result.result.type,
                "review": None,
                "error": None,
            }

            if result.result.type == "succeeded":
                msg = result.result.message
                text = next((b.text for b in msg.content if b.type == "text"), "")
                entry["review"] = text
                entry["input_tokens"] = msg.usage.input_tokens
                entry["output_tokens"] = msg.usage.output_tokens
            elif result.result.type == "errored":
                entry["error"] = str(result.result.error)

            results.append(entry)

    # Sort by agent ID
    results.sort(key=lambda x: x["agent_id"])
    return results


# ============================================================
# OUTPUT: JSON
# ============================================================

def save_json(results: list, path: Path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"  ✓ JSON saved: {path}")


# ============================================================
# OUTPUT: MARKDOWN REPORT
# ============================================================

def save_markdown(results: list, path: Path):
    lines = [
        "# THE BRIDGE — 100 Patient Reviews",
        f"**bridge-patient.html** · Generated {datetime.now().strftime('%B %d, %Y at %I:%M %p')}",
        f"**Model:** {MODEL} · **Agents:** Seoul Medical Group digital twins (seed=42)",
        "",
        "---",
        "",
    ]

    for r in results:
        d = r["agent_demographics"]
        b = r["agent_behavioral"]
        cl = r["agent_clinical"]
        lv = r["agent_living"]
        fam = r["agent_family"]
        pred = r["app_predictions"]

        lines.append(f"## {r['agent_id']} — {r['agent_name']}")
        lines.append("")
        lines.append("| Attribute | Value |")
        lines.append("|---|---|")
        lines.append(f"| Age | {d.get('age')} |")
        lines.append(f"| Ethnicity | {d.get('ethnicity')} |")
        lines.append(f"| City | {d.get('city')}, {d.get('state')} |")
        lines.append(f"| English Proficiency | {d.get('english_proficiency')} |")
        lines.append(f"| Digital Literacy | {b.get('digital_literacy')} |")
        lines.append(f"| Lives Alone | {lv.get('lives_alone')} |")
        lines.append(f"| Isolation Risk | {lv.get('social_isolation_risk')} |")
        lines.append(f"| Conditions | {', '.join(cl.get('chronic_conditions', []))} |")
        lines.append(f"| Care Gaps | {len(cl.get('care_gaps', []))} |")
        lines.append(f"| Children (distant) | {fam.get('children_count')} ({sum(1 for c in fam.get('children', []) if c['proximity_category'] in ('distant','overseas'))}) |")
        lines.append(f"| Share Willingness | {b.get('willingness_to_share_health_data')} |")
        lines.append(f"| Predicted Drop-off | {pred.get('dropoff_stage')} |")
        lines.append("")

        if r["status"] == "succeeded" and r["review"]:
            lines.append("### Review")
            lines.append("")
            lines.append(r["review"])
        elif r["error"]:
            lines.append(f"**ERROR:** {r['error']}")

        lines.append("")
        lines.append("---")
        lines.append("")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  ✓ Markdown saved: {path}")


# ============================================================
# OUTPUT: SUMMARY REPORT
# ============================================================

def save_summary(results: list, path: Path):
    """Segment-level analysis across all 100 reviews — the Objective 5 output."""
    succeeded = [r for r in results if r["status"] == "succeeded" and r["review"]]

    # Segment breakdowns
    def segment_reviews(label_fn, results):
        groups = {}
        for r in results:
            key = label_fn(r)
            groups.setdefault(key, []).append(r)
        return groups

    lines = [
        "# THE BRIDGE — Segment Analysis Summary",
        f"*{len(succeeded)} successful reviews analyzed · {datetime.now().strftime('%B %d, %Y')}*",
        "",
        "---",
        "",
        "## Key Metrics",
        "",
    ]

    # Counts
    korean = sum(1 for r in succeeded if r["agent_demographics"].get("ethnicity") == "Korean")
    alone = sum(1 for r in succeeded if r["agent_living"].get("lives_alone"))
    distant = sum(1 for r in succeeded if r["agent_family"].get("has_distant_child"))
    low_dig = sum(1 for r in succeeded if r["agent_behavioral"].get("digital_literacy") in ("low", "very_low"))
    low_eng = sum(1 for r in succeeded if r["agent_demographics"].get("english_proficiency") in ("none", "minimal"))

    lines += [
        f"| Metric | Count | % |",
        f"|---|---|---|",
        f"| Korean-American | {korean} | {korean/len(succeeded)*100:.0f}% |",
        f"| Lives alone | {alone} | {alone/len(succeeded)*100:.0f}% |",
        f"| Has distant child | {distant} | {distant/len(succeeded)*100:.0f}% |",
        f"| Low/very-low digital literacy | {low_dig} | {low_dig/len(succeeded)*100:.0f}% |",
        f"| Minimal/no English | {low_eng} | {low_eng/len(succeeded)*100:.0f}% |",
        "",
        "---",
        "",
    ]

    # Drop-off stage distribution
    stages = {}
    for r in succeeded:
        s = r["app_predictions"].get("dropoff_stage", "unknown")
        stages[s] = stages.get(s, 0) + 1
    lines += [
        "## Predicted Drop-Off Stages",
        "",
        "| Stage | Count | Bar |",
        "|---|---|---|",
    ]
    for s, cnt in sorted(stages.items(), key=lambda x: -x[1]):
        bar = "█" * cnt
        lines.append(f"| {s} | {cnt} | `{bar}` |")
    lines += ["", "---", ""]

    # Digital literacy × drop-off cross-tab
    lines += [
        "## Digital Literacy × Drop-Off",
        "",
        "| Digital Literacy | n | Most Common Drop-off |",
        "|---|---|---|",
    ]
    dl_groups = segment_reviews(lambda r: r["agent_behavioral"].get("digital_literacy", "?"), succeeded)
    for dl in ["very_low", "low", "moderate", "high"]:
        group = dl_groups.get(dl, [])
        if not group:
            continue
        stage_counts = {}
        for r in group:
            s = r["app_predictions"].get("dropoff_stage", "unknown")
            stage_counts[s] = stage_counts.get(s, 0) + 1
        top = max(stage_counts, key=stage_counts.get)
        lines.append(f"| {dl} | {len(group)} | {top} ({stage_counts[top]}) |")
    lines += ["", "---", ""]

    # English proficiency breakdown
    lines += [
        "## English Proficiency × Onboarding Prediction",
        "",
        "| English Level | n | Avg Self-Onboard % | Avg Child-Onboard % |",
        "|---|---|---|---|",
    ]
    eng_groups = segment_reviews(lambda r: r["agent_demographics"].get("english_proficiency", "?"), succeeded)
    for eng in ["none", "minimal", "limited", "proficient", "fluent"]:
        group = eng_groups.get(eng, [])
        if not group:
            continue
        avg_self = sum(r["app_predictions"].get("self_onboarding_rate", 0) for r in group) / len(group)
        avg_child = sum(r["app_predictions"].get("child_initiated_rate", 0) for r in group) / len(group)
        lines.append(f"| {eng} | {len(group)} | {avg_self*100:.0f}% | {avg_child*100:.0f}% |")
    lines += ["", "---", ""]

    # Age bracket breakdown
    lines += [
        "## Age Bracket Distribution",
        "",
        "| Age Bracket | n | Avg Share Willingness | Avg Digital Literacy Score |",
        "|---|---|---|---|",
    ]
    dl_scores = {"very_low": 1, "low": 2, "moderate": 3, "high": 4}

    def age_bracket(r):
        a = r["agent_demographics"].get("age", 70)
        if a < 65: return "60-64"
        if a < 70: return "65-69"
        if a < 75: return "70-74"
        if a < 80: return "75-79"
        if a < 85: return "80-84"
        return "85+"

    age_groups = segment_reviews(age_bracket, succeeded)
    for bracket in ["60-64", "65-69", "70-74", "75-79", "80-84", "85+"]:
        group = age_groups.get(bracket, [])
        if not group:
            continue
        avg_share = sum(r["agent_behavioral"].get("willingness_to_share_health_data", 0) for r in group) / len(group)
        avg_dl = sum(dl_scores.get(r["agent_behavioral"].get("digital_literacy", "low"), 2) for r in group) / len(group)
        lines.append(f"| {bracket} | {len(group)} | {avg_share:.2f} | {avg_dl:.1f}/4 |")
    lines += ["", "---", ""]

    # All reviews as excerpts (first 300 chars)
    lines += [
        "## Review Excerpts (First Impression, All 100)",
        "",
        "*The opening sentence of each agent's review — what they say first.*",
        "",
    ]
    for r in succeeded:
        review_text = r["review"] or ""
        # Get first ~200 chars of the actual review response
        excerpt = review_text.strip()[:280].replace("\n", " ")
        if len(review_text) > 280:
            excerpt += "..."
        d = r["agent_demographics"]
        lines.append(f"**{r['agent_id']} · {r['agent_name']}** ({d.get('age')}, {d.get('city')}, {d.get('english_proficiency')} EN, {r['agent_behavioral'].get('digital_literacy')} digital)")
        lines.append(f"> {excerpt}")
        lines.append("")

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  ✓ Summary saved: {path}")


# ============================================================
# MAIN
# ============================================================

def main():
    client = anthropic.Anthropic(
        api_key=os.environ.get("ANTHROPIC_API_KEY"),
        timeout=120.0,   # 2 min timeout for large batch submissions
    )

    print("\n" + "="*60)
    print("  THE BRIDGE — 100 Patient Reviews Runner")
    print("="*60)

    # Output paths
    json_path = SCRIPT_DIR / f"bridge_reviews_{TIMESTAMP}.json"
    md_path = SCRIPT_DIR / f"bridge_reviews_{TIMESTAMP}.md"
    summary_path = SCRIPT_DIR / f"bridge_reviews_summary_{TIMESTAMP[:8]}.md"

    # ── RETRIEVE MODE ──────────────────────────────────────────
    if "--retrieve" in sys.argv:
        batch_id = sys.argv[sys.argv.index("--retrieve") + 1]
        print(f"\n  Loading agents...")
        agents = load_agents()
        print(f"  ✓ {len(agents)} agents loaded")
        print(f"\n  Retrieving results for batch: {batch_id}")
        results = collect_results(batch_id, agents, client)
        save_json(results, json_path)
        save_markdown(results, md_path)
        save_summary(results, summary_path)
        print(f"\n  Done. {sum(1 for r in results if r['status']=='succeeded')} reviews saved.")
        return

    # ── FROM-JSON MODE ─────────────────────────────────────────
    if "--from-json" in sys.argv:
        json_file = sys.argv[sys.argv.index("--from-json") + 1]
        with open(json_file) as f:
            results = json.load(f)
        print(f"\n  Re-analyzing {len(results)} results from {json_file}")
        save_markdown(results, md_path)
        save_summary(results, summary_path)
        print(f"\n  Done.")
        return

    # ── NORMAL / SUBMIT-ONLY MODE ──────────────────────────────
    print(f"\n  Loading agents...")
    agents = load_agents()
    print(f"  ✓ {len(agents)} agents loaded")

    # Show quick preview
    print(f"\n  Agent snapshot:")
    korean_n = sum(1 for a in agents if a["demographics"]["ethnicity"] == "Korean")
    ages = [a["demographics"]["age"] for a in agents]
    low_dl = sum(1 for a in agents if a["behavioral"]["digital_literacy"] in ("low", "very_low"))
    print(f"    Korean: {korean_n}/100  |  Age range: {min(ages)}–{max(ages)}, median {sorted(ages)[50]}")
    print(f"    Low/very-low digital literacy: {low_dl}/100")
    print(f"    Model: {MODEL}  |  Max tokens/review: {MAX_TOKENS}")
    print(f"    Estimated cost: ~${100 * 3000 * 0.000003 * 0.5:.2f} (batch 50% discount)")

    # Submit
    batch_id = submit_batch(agents, client)

    if "--submit-only" in sys.argv:
        print(f"\n  Batch submitted. To retrieve results later:")
        print(f"  python3 run-100-reviews.py --retrieve {batch_id}")
        return

    # Poll + collect
    poll_until_complete(batch_id, client)
    print(f"\n  Collecting results...")
    results = collect_results(batch_id, agents, client)

    # Save outputs
    print(f"\n  Saving outputs...")
    save_json(results, json_path)
    save_markdown(results, md_path)
    save_summary(results, summary_path)

    succeeded = sum(1 for r in results if r["status"] == "succeeded")
    total_in = sum(r.get("input_tokens", 0) for r in results)
    total_out = sum(r.get("output_tokens", 0) for r in results)

    print(f"\n{'='*60}")
    print(f"  COMPLETE")
    print(f"  Reviews: {succeeded}/100 succeeded")
    print(f"  Tokens: {total_in:,} in · {total_out:,} out")
    print(f"  Files:")
    print(f"    {json_path.name}")
    print(f"    {md_path.name}")
    print(f"    {summary_path.name}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()

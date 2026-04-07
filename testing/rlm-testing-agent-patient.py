#!/usr/bin/env python3
"""
THE BRIDGE — RLM (Recursive Language Model) Engine
====================================================
Runs alongside testing_agents.py to orchestrate analysis and simulation.

This is the Root Agent orchestrator. It never processes raw data directly.
It peeks, partitions, spawns sub-agents, collects results, and synthesizes.

SETUP:
  1. Place this file in the same directory as testing_agents.py
  2. Set your API key: export ANTHROPIC_API_KEY=your_key_here
  3. Run: python3 rlm_engine.py

COMMANDS:
  python3 rlm_engine.py analyze                    # Full RLM analysis of all 100 agents
  python3 rlm_engine.py simulate                   # Run all agents through app screens
  python3 rlm_engine.py simulate --agent 17        # Simulate one agent through all screens
  python3 rlm_engine.py simulate --screen onboard  # All agents through onboarding
  python3 rlm_engine.py dropoff                    # Full drop-off analysis
  python3 rlm_engine.py children                   # Children experience simulation
  python3 rlm_engine.py report                     # Generate full report from all results
  python3 rlm_engine.py report --format md         # Export as markdown
  python3 rlm_engine.py report --format json       # Export as JSON
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# ============================================================
# IMPORT TESTING AGENTS
# ============================================================
try:
    from importlib.util import spec_from_file_location, module_from_spec
    _agents_path = Path(__file__).parent / "100-testing-agents-(seniors-patients).py"
    _spec = spec_from_file_location("testing_agents", _agents_path)
    _agents_mod = module_from_spec(_spec)
    _spec.loader.exec_module(_agents_mod)
    generate_all_agents = _agents_mod.generate_all_agents
    generate_review_prompt = _agents_mod.generate_review_prompt
except Exception as e:
    print(f"ERROR: Could not load 100-testing-agents-(seniors-patients).py — {e}")
    print("Make sure it's in the same directory as this file.")
    sys.exit(1)

# ============================================================
# CONFIGURATION
# ============================================================

CONFIG = {
    "model": "claude-opus-4-6",
    "max_tokens": 1500,
    "results_dir": str(Path(__file__).parent / "rlm_results"),
    "use_api": False,  # Set False for dry-run (generates prompts without calling API)
}

# ============================================================
# API CLIENT
# ============================================================

def call_claude(system_prompt, user_prompt, max_tokens=None):
    """Call Claude API. Falls back to dry-run if no API key."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")

    if not api_key or not CONFIG["use_api"]:
        # Dry run — save the prompt instead
        return {
            "mode": "dry_run",
            "system": system_prompt,
            "user": user_prompt,
            "response": "[DRY RUN — Set ANTHROPIC_API_KEY and CONFIG['use_api']=True to get real responses]"
        }

    try:
        import urllib.request
        body = json.dumps({
            "model": CONFIG["model"],
            "max_tokens": max_tokens or CONFIG["max_tokens"],
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}]
        })
        import ssl
        try:
            import certifi
            ssl_ctx = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            ssl_ctx = ssl.create_default_context()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body.encode(),
            headers={
                "Content-Type": "application/json",
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01"
            }
        )
        with urllib.request.urlopen(req, timeout=180, context=ssl_ctx) as resp:
            data = json.loads(resp.read().decode())
            text = "".join(b.get("text", "") for b in data.get("content", []))
            return {"mode": "live", "response": text}
    except Exception as e:
        return {"mode": "error", "error": str(e), "response": f"[API ERROR: {e}]"}


# ============================================================
# RESULTS MANAGER
# ============================================================

class ResultsManager:
    def __init__(self):
        self.dir = Path(CONFIG["results_dir"])
        self.dir.mkdir(exist_ok=True)
        (self.dir / "analysis").mkdir(exist_ok=True)
        (self.dir / "simulations").mkdir(exist_ok=True)
        (self.dir / "dropoff").mkdir(exist_ok=True)
        (self.dir / "children").mkdir(exist_ok=True)
        (self.dir / "reports").mkdir(exist_ok=True)

    def save(self, category, filename, data):
        path = self.dir / category / filename
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        return path

    def load(self, category, filename):
        path = self.dir / category / filename
        if path.exists():
            with open(path) as f:
                return json.load(f)
        return None

    def list_results(self, category):
        path = self.dir / category
        return sorted(path.glob("*.json")) if path.exists() else []


results = ResultsManager()

# ============================================================
# PHASE 1: ROOT AGENT — PEEK & PARTITION
# ============================================================

def partition_agents(agents):
    """
    Root Agent's PARTITION decision.
    Splits 100 agents into sub-agent partitions by ethnicity × age × wealth.
    No LLM involved — pure deterministic grouping.
    """
    partitions = {
        "korean_60_64": [],
        "korean_65_74": [],
        "korean_75_84": [],
        "korean_85_plus": [],
        "korean_under_60": [],
        "nonkorean_60_plus": [],
        "nonkorean_under_60": [],
        # Cross-cuts
        "recent_arrivals": [],       # PCP tenure <= 2yr, age 63-72
        "isolated_elderly": [],      # Lives alone + age 75+ + very low digital lit
        "high_need_complex": [],     # 4+ conditions + low health activation
        "distant_children_only": [], # Has distant child but no local child
        "no_children": [],           # No children at all
    }

    for a in agents:
        age = a["demographics"]["age"]
        is_korean = a["demographics"]["ethnicity"] == "Korean"
        tenure = a["pcp"]["tenure_years"]
        alone = a["living_situation"]["lives_alone"]
        dl = a["behavioral"]["digital_literacy"]
        conditions = a["clinical"]["chronic_conditions"]
        ha = a["clinical"]["health_activation"]
        has_distant = a["family"]["has_distant_child"]
        has_local = a["family"]["has_local_child"]
        num_children = a["family"]["children_count"]

        # Primary partitions
        if is_korean:
            if age < 60: partitions["korean_under_60"].append(a)
            elif age < 65: partitions["korean_60_64"].append(a)
            elif age < 75: partitions["korean_65_74"].append(a)
            elif age < 85: partitions["korean_75_84"].append(a)
            else: partitions["korean_85_plus"].append(a)
        else:
            if age >= 60: partitions["nonkorean_60_plus"].append(a)
            else: partitions["nonkorean_under_60"].append(a)

        # Cross-cuts (agents can appear in multiple cross-cuts)
        if tenure <= 2 and 63 <= age <= 72:
            partitions["recent_arrivals"].append(a)
        if alone and age >= 75 and dl in ("very_low", "low"):
            partitions["isolated_elderly"].append(a)
        if len([c for c in conditions if c != "none"]) >= 4 and ha in ("low", "very_low"):
            partitions["high_need_complex"].append(a)
        if has_distant and not has_local:
            partitions["distant_children_only"].append(a)
        if num_children == 0:
            partitions["no_children"].append(a)

    return partitions


# ============================================================
# PHASE 2: SUB-AGENT ANALYSIS
# ============================================================

SUB_AGENT_SYSTEM = """You are a Sub-Agent in the RLM (Recursive Language Model) system analyzing 
Seoul Medical Group patient data for The Bridge app.

You receive ONLY your assigned partition of patients. You have ZERO visibility into other partitions.

Your job:
1. Analyze the demographic, behavioral, and clinical patterns in your partition
2. Identify the 2-3 dominant behavioral archetypes within this group
3. Predict how this group would interact with The Bridge app
4. Identify the primary drop-off risk for this segment
5. Recommend the ideal onboarding strategy

RULES:
- Only cite statistics from the data provided to you
- If something is uncertain, say "LOW CONFIDENCE" and explain why
- Return your analysis as structured JSON
- Never invent numbers — if the partition is too small (<5 agents), flag it"""

def run_sub_agent(partition_name, agents_in_partition):
    """Run a sub-agent analysis on one partition."""
    if not agents_in_partition:
        return {"partition": partition_name, "n": 0, "skipped": True, "reason": "empty partition"}

    # Build partition summary (what the sub-agent sees)
    partition_data = {
        "partition_name": partition_name,
        "n": len(agents_in_partition),
        "agents": []
    }

    for a in agents_in_partition:
        # Sub-agent sees a stripped version — no raw names, just behavioral data
        partition_data["agents"].append({
            "id": a["id"],
            "age": a["demographics"]["age"],
            "gender": a["demographics"]["gender"],
            "ethnicity": a["demographics"]["ethnicity"],
            "english_proficiency": a["demographics"]["english_proficiency"],
            "wealth_tier": a["demographics"]["wealth_tier"],
            "city": a["demographics"]["city"],
            "zip": a["demographics"]["zip"],
            "broadband": a["demographics"]["broadband_access"],
            "plan_type": a["insurance"]["plan_name"],
            "conditions": a["clinical"]["chronic_conditions"],
            "care_gaps": a["clinical"]["care_gaps"],
            "medications": a["clinical"]["estimated_medications"],
            "health_activation": a["clinical"]["health_activation"],
            "digital_literacy": a["behavioral"]["digital_literacy"],
            "smartphone": a["behavioral"]["smartphone"],
            "trust_in_tech": a["behavioral"]["trust_in_technology"],
            "share_willingness": a["behavioral"]["willingness_to_share_health_data"],
            "lives_alone": a["living_situation"]["lives_alone"],
            "isolation_risk": a["living_situation"]["social_isolation_risk"],
            "children_count": a["family"]["children_count"],
            "has_distant_child": a["family"]["has_distant_child"],
            "has_local_child": a["family"]["has_local_child"],
            "pcp_tenure": a["pcp"]["tenure_years"],
            "predicted_dropoff": a["app_predictions"]["dropoff_stage"],
        })

    user_prompt = f"""Analyze this partition of {len(agents_in_partition)} patients from Seoul Medical Group.

PARTITION: {partition_name}
DATA:
{json.dumps(partition_data, indent=2)}

Return a JSON analysis with:
{{
  "partition": "{partition_name}",
  "n": {len(agents_in_partition)},
  "summary": {{
    "median_age": number,
    "pct_female": number,
    "pct_lives_alone": number,
    "pct_low_digital_literacy": number,
    "pct_limited_english": number,
    "pct_has_distant_child": number,
    "avg_conditions": number,
    "avg_care_gaps": number,
    "dominant_wealth_tier": string,
    "dominant_city": string
  }},
  "archetypes": [
    {{
      "name": "short descriptive name",
      "pct_of_partition": number,
      "description": "one paragraph behavioral description",
      "bridge_prediction": "how they'll interact with the app",
      "primary_dropoff": "where and why they'll abandon",
      "ideal_entry": "best way to get them started"
    }}
  ],
  "segment_risk_score": number (1-10, 10=highest drop-off risk),
  "key_insight": "the single most important finding about this group",
  "recommended_action": "what The Bridge team should do for this segment"
}}"""

    result = call_claude(SUB_AGENT_SYSTEM, user_prompt)
    result["partition"] = partition_name
    result["n"] = len(agents_in_partition)
    result["agent_ids"] = [a["id"] for a in agents_in_partition]
    return result


# ============================================================
# PHASE 3: APP SCREEN SIMULATION
# ============================================================

APP_SCREENS = {
    "sms_invite": {
        "name": "SMS Invitation",
        "stage": "awareness",
        "description": """You receive a text message on your phone from Seoul Medical Group:

"[Seoul Medical Group] Hi {name}, we have a new app called The Bridge that helps your family stay connected to your health care. Your {child_relation} requested this for you. Download here: [link]"

This is the first time you've heard of this app. What do you do?"""
    },
    "app_store": {
        "name": "App Store Page",
        "stage": "download",
        "description": """You open the App Store on your phone. You see The Bridge app:

Title: "The Bridge — Family Health Dashboard"
Rating: 4.2 stars (128 reviews)
Description: "Give your family peace of mind. The Bridge connects your Seoul Medical Group health data with your loved ones, so they can see your appointments, medication reminders, and care gaps."
Screenshots show: A dashboard with appointment dates, a medication list, a care gap alert
The app is in English. There's a small note: "Korean language supported"
File size: 85 MB
Button: "GET" (free)

What is your reaction? Do you download it?"""
    },
    "account_create": {
        "name": "Account Creation",
        "stage": "onboarding",
        "description": """You've opened The Bridge app. The first screen says "Create Your Account" in English.
There is a small toggle in the top-right corner that says "EN | 한국어"

Fields to fill in:
- Full Name
- Date of Birth (month/day/year format)
- Email Address (required)
- Create Password (must be 8+ characters, include a number and uppercase letter)
- Phone Number
- Member ID (it says "found on your insurance card")

At the bottom: "By creating an account you agree to our Terms of Service and Privacy Policy"
Button: "Create Account"

Can you complete this form? What problems do you encounter?"""
    },
    "record_linking": {
        "name": "Health Record Linking",
        "stage": "onboarding",
        "description": """After creating your account, you see this screen:

"Connect Your Health Records"
"To see your health information in The Bridge, we need to verify your identity and link your Seoul Medical Group medical records."

"Please enter:"
- Your Seoul Medical Group Member ID (shown as: H followed by 10 numbers)
- Your date of birth
- Last 4 digits of your Social Security Number

"Your health data will be encrypted and only shared with family members you approve."

Button: "Connect My Records"
Small link: "I need help finding my Member ID"

What do you do? Do you trust this screen?"""
    },
    "data_sharing": {
        "name": "Data Sharing Consent",
        "stage": "family_invite",
        "description": """A new screen appears:

"Choose What to Share with Your Family"

"The Bridge lets your family members see selected parts of your health information. You control what they can see."

Toggles (all ON by default):
✅ Upcoming appointments (date, time, doctor name)
✅ Care gap alerts (overdue screenings and tests)  
✅ Medication reminders (medication names, schedule)
✅ Referral status (specialist referrals)
❌ Diagnosis details (turned OFF by default)
❌ Lab results (turned OFF by default)

"You can change these settings at any time."

Buttons: "Save & Continue" / "Skip for Now"

How do you feel about these options? What do you do?"""
    },
    "family_invite": {
        "name": "Family Member Invitation",
        "stage": "family_invite",
        "description": """Screen: "Invite Your Family"

"Send an invitation to your family members so they can view your health dashboard."

Input field: "Enter email address or phone number"
Dropdown: "Relationship" (Son / Daughter / Spouse / Other)

Below the form it says:
"Your family member will receive an invitation to download The Bridge and create their own account. They will only see the information you chose to share."

Buttons: "Send Invitation" / "Add Another Family Member" / "Skip for Now"

Do you know your child's email? Do you send the invite? What hesitation do you feel?"""
    },
    "dashboard_first": {
        "name": "Dashboard First View",
        "stage": "first_use",
        "description": """You (or your child) have set up The Bridge. You open it and see your dashboard:

Welcome, {name}!

📅 NEXT APPOINTMENT
Dr. {pcp_name} — {next_apt_date} at 2:00 PM
Seoul Medical Group, Koreatown

⚠️ CARE GAPS ({num_gaps})
{care_gaps_list}

💊 MEDICATIONS ({num_meds} active)
Reminders set for: 8:00 AM, 12:00 PM, 8:00 PM

🔔 2 new notifications

Bottom navigation: Home | Appointments | Medications | Family | Settings

What do you look at first? What confuses you? Is this useful?"""
    },
    "notification_day3": {
        "name": "Day 3 Notifications",
        "stage": "week_1",
        "description": """It's been 3 days since you started using The Bridge. Today you received:

9:00 AM — "💊 Medication Reminder: Time to take your morning medications"
11:30 AM — "📅 Reminder: Your appointment with Dr. {pcp_name} is in 2 days"
3:00 PM — "💊 Medication Reminder: Time to take your afternoon medications"

Your phone has buzzed 3 times today from this app. You also got notifications from KakaoTalk, your regular text messages, and a weather alert.

How do you feel about these notifications? Are they helpful or annoying? Do you open the app? Do you consider turning off notifications?"""
    },
    "quiet_day7": {
        "name": "Day 7 — Quiet Period",
        "stage": "week_1",
        "description": """It's been a full week. You went to your doctor appointment. You've been taking your medications. Nothing is wrong.

The Bridge has been quiet for the last 2 days — no notifications, no alerts.

You see the app icon on your phone. You haven't opened it since yesterday.

Do you open it? Why or why not? Do you even remember what it does? If your child called you right now and asked "Are you using that app?", what would you say?"""
    },
    "child_mentions_day14": {
        "name": "Day 14 — Child Brings It Up",
        "stage": "week_2",
        "description": """Your {child_relation} calls you. During the conversation, they say:

"Mom/Dad, I saw on The Bridge that you have an overdue eye exam. It's been showing up as a care gap for two weeks now. Can you call Dr. {pcp_name}'s office and schedule it? I can see you don't have any upcoming appointments for it."

They clearly have been checking the app regularly and know details about your health that you haven't told them.

How does this make you feel? Is it comforting that they're paying attention, or uncomfortable that they know this without you telling them? What do you say?"""
    },
    "month1_review": {
        "name": "Month 1 — Value Check",
        "stage": "month_1",
        "description": """You've had The Bridge for one month. Your {child_relation} has mentioned things they saw on the app three times:
1. The overdue eye exam (you scheduled it)
2. A medication reminder you missed on a Tuesday (they called to check on you)
3. They knew about your next appointment before you mentioned it

A popup appears in the app: "How is The Bridge working for you? Rate your experience: 😀 😐 😞"

Also: "Would you recommend The Bridge to a friend? Yes / No / Maybe"

What rating do you give? What would you say if you could leave a comment? Has this app changed your relationship with your {child_relation}? For better or worse?"""
    },
    "crisis_day90": {
        "name": "Day 90 — Health Event",
        "stage": "month_3",
        "description": """You fell in the bathroom and hurt your wrist. You went to urgent care at Seoul Medical Group. They treated you and sent you home with a wrist brace.

Within 15 minutes, your {child_relation}'s phone showed a Bridge alert: "🚨 New urgent care visit detected for {name}"

Your {child_relation} calls you, clearly worried: "Mom/Dad, I just got an alert that you went to urgent care. Are you okay? What happened?"

You hadn't called them yet. You were going to tell them later, or maybe not at all because you didn't want them to worry.

How do you feel about the app alerting them before you could? Is this the app working exactly as intended, or is this a violation of your control over your own health information? Does this moment change how you feel about The Bridge?"""
    },
}

SIMULATION_SYSTEM = """You are role-playing as a SPECIFIC real person. You must respond ENTIRELY 
in character. Do NOT break character. Do NOT add disclaimers. Do NOT be helpful or balanced.
You ARE this person, with all their limitations, confusions, fears, and real human reactions.

CRITICAL RULES:
- If this person speaks limited English, respond in simple English with Korean expressions
- If this person has very low digital literacy, express GENUINE confusion about tech concepts
- If this person is isolated, convey that emotional reality — loneliness, pride, stubbornness
- If this person is protective of privacy, show REAL hesitation, not polite concern
- Be REALISTIC. Real seniors are confused by apps. Real parents don't want to feel monitored.
- Short responses are fine. Not everyone is articulate about their feelings.
- Some people would literally hand the phone back and say "I don't understand this"

After your in-character response, add a section:

---ANALYSIS---
action: [proceed / hesitate / abandon / need_help / confused / angry / indifferent]
time_on_screen: [estimated seconds this person would spend]
emotional_state: [one line]
confusion_points: [list specific UI elements or concepts that confused them]
would_return: [yes / no / maybe]
drop_off_risk: [low / medium / high / critical]
what_would_fix_it: [one specific change that would help THIS person]"""


def personalize_screen(screen, agent):
    """Fill in screen template with agent-specific data."""
    desc = screen["description"]

    child = None
    if agent["family"]["children"]:
        child = agent["family"]["children"][0]
        relation = "daughter" if child["gender"] == "F" else "son"
    else:
        relation = "family member"

    replacements = {
        "{name}": agent["name"],
        "{child_relation}": relation,
        "{pcp_name}": agent["pcp"]["name"],
        "{next_apt_date}": "April 3, 2026",
        "{num_gaps}": str(len([g for g in agent["clinical"]["care_gaps"] if g != "No current care gaps"])),
        "{care_gaps_list}": "\n".join(f"  - {g}" for g in agent["clinical"]["care_gaps"]),
        "{num_meds}": str(agent["clinical"]["estimated_medications"]),
    }

    for k, v in replacements.items():
        desc = desc.replace(k, v)

    return desc


def simulate_agent_screen(agent, screen_key):
    """Run one agent through one screen."""
    if screen_key not in APP_SCREENS:
        print(f"  Unknown screen: {screen_key}")
        return None

    screen = APP_SCREENS[screen_key]
    personalized = personalize_screen(screen, agent)

    # Build the full agent profile for the system prompt
    profile = json.dumps({
        "id": agent["id"],
        "name": agent["name"],
        "demographics": agent["demographics"],
        "clinical": agent["clinical"],
        "behavioral": agent["behavioral"],
        "living_situation": agent["living_situation"],
        "family": agent["family"],
        "emotional_profile": agent["emotional_profile"],
    }, indent=2)

    system = SIMULATION_SYSTEM
    user = f"""YOUR IDENTITY:
{profile}

SCREEN: {screen['name']} (Stage: {screen['stage']})
{personalized}

Respond as {agent['name']} would. Stay completely in character."""

    result = call_claude(system, user)
    result["agent_id"] = agent["id"]
    result["agent_name"] = agent["name"]
    result["screen"] = screen_key
    result["screen_name"] = screen["name"]
    result["stage"] = screen["stage"]
    result["timestamp"] = datetime.now().isoformat()

    return result


# ============================================================
# PHASE 4: CHILDREN SIMULATION
# ============================================================

CHILD_SCREENS = {
    "child_invite_received": {
        "name": "Child Receives Invite",
        "description": """You receive a text message: "Your {parent_relation} ({parent_name}) has invited you to The Bridge — a health dashboard from Seoul Medical Group. Download the app to view their appointments, care gaps, and medication reminders. [link]"

You live in {child_city}, {child_distance} miles from your {parent_relation}. You currently {current_monitoring}.

What's your first reaction? Do you download it?"""
    },
    "child_first_dashboard": {
        "name": "Child Sees Dashboard",
        "description": """You've downloaded The Bridge and linked to your {parent_relation}'s account. You see:

📅 Next Appointment: Dr. {pcp_name}, April 3 at 2:00 PM
⚠️ Care Gaps: {num_gaps} overdue
💊 Medications: {num_meds} active, last confirmed 2 days ago
📊 Last doctor visit: March 15, 2026

You're looking at your {parent_relation}'s health data for the first time from {child_city}. What do you feel? What do you click first? What do you wish you could see that isn't here?"""
    },
    "child_cant_act": {
        "name": "Child Frustrated — Can't Act",
        "description": """You've been using The Bridge for 3 weeks. You can see your {parent_relation} has {num_gaps} overdue care gaps: {care_gaps_list}

You want to schedule these appointments. But The Bridge only shows you the information — there's no button to schedule, no way to message the doctor, no way to do anything except look.

You call your {parent_relation} and say "I saw you have an overdue eye exam." They say "I know, I'll get to it." But it's been 3 weeks and they haven't.

How frustrated are you? What do you wish the app let you do? Would you keep using an app that only lets you WATCH but not ACT?"""
    },
    "child_crisis_alert": {
        "name": "Child Gets Crisis Alert",
        "description": """Your phone buzzes at 2:30 PM on a Wednesday:

🚨 The Bridge Alert: "New urgent care visit detected for {parent_name}"

You're at work in {child_city}. Your heart drops. You call your {parent_relation} immediately but they don't pick up. You call again. No answer.

You're {child_distance} miles away. What do you do? What do you feel? Is this alert a blessing or a curse? If the app also showed you "Reason: wrist injury, discharged, follow-up in 1 week" — would that help or make it worse?"""
    },
    "child_month1_reflection": {
        "name": "Child Month 1 Reflection",
        "description": """You've had The Bridge for a month. You check it {check_frequency}. 

Here's what happened this month:
- You saw your {parent_relation} went to their appointment ✅
- You noticed an overdue care gap and called about it
- You saw medication reminders were sometimes missed
- Your {parent_relation} mentioned feeling "watched" once

Has The Bridge reduced your worry? Has it created new worry? Has it changed how you talk to your {parent_relation}? Would you recommend it to a friend whose parent is also far away? What feature would you pay $10/month for?"""
    },
}


def simulate_child(agent, screen_key):
    """Simulate the adult child's experience."""
    if not agent["family"]["children"]:
        return {"skipped": True, "reason": "no children"}

    child = agent["family"]["children"][0]
    screen = CHILD_SCREENS.get(screen_key)
    if not screen:
        return {"error": f"Unknown child screen: {screen_key}"}

    desc = screen["description"]
    relation = "mother" if agent["demographics"]["gender"] == "Female" else "father"

    replacements = {
        "{parent_relation}": relation,
        "{parent_name}": agent["name"],
        "{child_city}": child["location"],
        "{child_distance}": str(child["distance_miles"]),
        "{pcp_name}": agent["pcp"]["name"],
        "{num_gaps}": str(len([g for g in agent["clinical"]["care_gaps"] if g != "No current care gaps"])),
        "{num_meds}": str(agent["clinical"]["estimated_medications"]),
        "{care_gaps_list}": ", ".join(agent["clinical"]["care_gaps"][:3]),
        "{current_monitoring}": f"call your {relation} {child['contact_frequency'].replace('_', ' ')}",
        "{check_frequency}": "every day" if child["caregiving_burden"] == "high" else "a few times a week" if child["caregiving_burden"] == "moderate" else "once a week",
    }

    for k, v in replacements.items():
        desc = desc.replace(k, v)

    child_profile = {
        "role": f"Adult child of {agent['name']}",
        "age": child["age"],
        "gender": child["gender"],
        "location": child["location"],
        "distance": f"{child['distance_miles']} miles",
        "proximity": child["proximity_category"],
        "caregiving_burden": child["caregiving_burden"],
        "is_primary_caregiver": child["is_primary_caregiver"],
        "parent_age": agent["demographics"]["age"],
        "parent_conditions": agent["clinical"]["chronic_conditions"],
        "parent_digital_literacy": agent["behavioral"]["digital_literacy"],
        "parent_english": agent["demographics"]["english_proficiency"],
        "parent_lives_alone": agent["living_situation"]["lives_alone"],
    }

    system = """You are role-playing as the ADULT CHILD of a Korean American senior. 
You are worried about your parent. You live far away. You feel guilty.
Respond with raw emotional honesty. Don't be polite about the app — be REAL.

After your response, add:
---ANALYSIS---
emotional_state: [one line]
engagement_level: [high / moderate / low / disengaged]
would_pay_for_premium: [yes / no / amount]
biggest_frustration: [one specific thing]
retention_prediction: [will use in 3 months: yes / no / maybe]"""

    user = f"""YOUR IDENTITY:
{json.dumps(child_profile, indent=2)}

SCREEN: {screen['name']}
{desc}

Respond as this person would. Be emotionally honest."""

    result = call_claude(system, user)
    result["parent_agent_id"] = agent["id"]
    result["child_location"] = child["location"]
    result["screen"] = screen_key
    result["timestamp"] = datetime.now().isoformat()
    return result


# ============================================================
# PHASE 5: ROOT AGENT SYNTHESIS
# ============================================================

ROOT_SYNTHESIS_SYSTEM = """You are the Root Agent in an RLM (Recursive Language Model) system.
You are synthesizing findings from multiple sub-agents who each analyzed a different partition
of Seoul Medical Group patient data for The Bridge app.

You NEVER saw the raw data. You only see sub-agent summaries.

Your job:
1. Identify the 3 most critical findings across all partitions
2. Find conflicts between sub-agents and flag them
3. Recommend the top 5 product/UX changes for The Bridge
4. Size the addressable market for each engagement mode (distant vs local children)
5. Predict the overall onboarding funnel and 90-day retention

RULES:
- Every number you cite must reference which sub-agent provided it
- If two sub-agents conflict, present BOTH findings — don't average
- Be direct and actionable — this goes to the product team"""


def synthesize_results():
    """Root Agent reads all sub-agent outputs and synthesizes."""
    # Gather all results
    analysis_files = results.list_results("analysis")
    sim_files = results.list_results("simulations")
    dropoff_files = results.list_results("dropoff")
    child_files = results.list_results("children")

    all_analyses = []
    for f in analysis_files:
        data = results.load("analysis", f.name)
        if data:
            all_analyses.append(data)

    all_sims = []
    for f in sim_files:
        data = results.load("simulations", f.name)
        if data:
            all_sims.append(data)

    summary = {
        "analysis_count": len(all_analyses),
        "simulation_count": len(all_sims),
        "analyses": [{"partition": a.get("partition"), "n": a.get("n")} for a in all_analyses],
    }

    user_prompt = f"""Synthesize these RLM sub-agent findings for The Bridge app:

SUB-AGENT RESULTS:
{json.dumps(all_analyses, indent=2, default=str)[:8000]}

SIMULATION RESULTS SUMMARY:
{json.dumps(summary, indent=2)}

Provide your synthesis as the Root Agent. Be specific and actionable."""

    result = call_claude(ROOT_SYNTHESIS_SYSTEM, user_prompt, max_tokens=3000)
    result["type"] = "root_synthesis"
    result["timestamp"] = datetime.now().isoformat()
    result["inputs"] = summary

    results.save("reports", f"synthesis_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json", result)
    return result


# ============================================================
# REPORT GENERATOR
# ============================================================

def generate_report(fmt="md"):
    """Generate a comprehensive report from all results."""
    agents = generate_all_agents(100)
    partitions = partition_agents(agents)

    report_lines = []
    report_lines.append("# THE BRIDGE — RLM Analysis Report")
    report_lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    report_lines.append(f"Total Testing Agents: 100")
    report_lines.append("")

    # Partition summary
    report_lines.append("## Partition Summary")
    report_lines.append("")
    for name, agents_list in partitions.items():
        if agents_list:
            ages = [a["demographics"]["age"] for a in agents_list]
            med_age = sorted(ages)[len(ages)//2]
            alone_pct = sum(1 for a in agents_list if a["living_situation"]["lives_alone"]) / len(agents_list) * 100
            distant_pct = sum(1 for a in agents_list if a["family"]["has_distant_child"]) / len(agents_list) * 100
            dl_low = sum(1 for a in agents_list if a["behavioral"]["digital_literacy"] in ("very_low","low")) / len(agents_list) * 100
            report_lines.append(f"### {name} (n={len(agents_list)})")
            report_lines.append(f"- Median age: {med_age}")
            report_lines.append(f"- Lives alone: {alone_pct:.0f}%")
            report_lines.append(f"- Has distant child: {distant_pct:.0f}%")
            report_lines.append(f"- Low/very-low digital literacy: {dl_low:.0f}%")
            report_lines.append("")

    # Drop-off predictions
    report_lines.append("## Predicted Drop-Off Distribution")
    report_lines.append("")
    stages = {}
    for a in generate_all_agents(100):
        s = a["app_predictions"]["dropoff_stage"]
        stages[s] = stages.get(s, 0) + 1
    for s, cnt in sorted(stages.items(), key=lambda x: -x[1]):
        bar = "█" * cnt
        report_lines.append(f"- {s}: {cnt} agents {bar}")
    report_lines.append("")

    # Key metrics
    all_agents = generate_all_agents(100)
    avg_self = sum(a["app_predictions"]["self_onboarding_rate"] for a in all_agents) / 100
    avg_child = sum(a["app_predictions"]["child_initiated_rate"] for a in all_agents) / 100
    avg_w1 = sum(a["app_predictions"]["week_1_retention"] for a in all_agents) / 100
    avg_m1 = sum(a["app_predictions"]["month_1_retention"] for a in all_agents) / 100

    report_lines.append("## Predicted Metrics")
    report_lines.append(f"- Average self-onboarding rate: {avg_self*100:.1f}%")
    report_lines.append(f"- Average child-initiated rate: {avg_child*100:.1f}%")
    report_lines.append(f"- Average week-1 retention: {avg_w1*100:.1f}%")
    report_lines.append(f"- Average month-1 retention: {avg_m1*100:.1f}%")
    report_lines.append("")

    # Existing results
    report_lines.append("## Collected Results")
    for cat in ["analysis", "simulations", "dropoff", "children", "reports"]:
        files = results.list_results(cat)
        report_lines.append(f"- {cat}: {len(files)} result files")

    # Root Agent synthesis — load the latest successful synthesis file
    reports_dir = results.dir / "reports"
    synthesis_files = sorted(reports_dir.glob("synthesis_*.json"), reverse=True)
    for sf in synthesis_files:
        try:
            with open(sf) as f:
                syn = json.load(f)
            if syn.get("mode") == "live" and syn.get("response"):
                report_lines.append("")
                report_lines.append("---")
                report_lines.append("")
                report_lines.append("## Root Agent Synthesis")
                report_lines.append(f"*Generated: {syn.get('timestamp', '')}*")
                report_lines.append("")
                report_lines.append(syn["response"])
                break
        except Exception:
            continue

    report_text = "\n".join(report_lines)

    if fmt == "json":
        report_data = {
            "title": "The Bridge RLM Analysis Report",
            "generated": datetime.now().isoformat(),
            "partitions": {k: len(v) for k, v in partitions.items()},
            "metrics": {"avg_self_onboard": avg_self, "avg_child_onboard": avg_child, "avg_w1": avg_w1, "avg_m1": avg_m1},
            "dropoff_distribution": stages,
        }
        path = results.save("reports", f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json", report_data)
        print(f"\n  Report saved to: {path}")
        return

    path = results.dir / "reports" / f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    with open(path, "w") as f:
        f.write(report_text)
    print(report_text)
    print(f"\n  Report saved to: {path}")


# ============================================================
# CLI ROUTER
# ============================================================

def main():
    agents = generate_all_agents(100)

    if len(sys.argv) < 2:
        print("""
╔══════════════════════════════════════════════════════════════╗
║  THE BRIDGE — RLM Engine                                     ║
║  Recursive Language Model Analysis & Simulation Runner       ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  COMMANDS:                                                   ║
║    analyze              Full RLM sub-agent analysis           ║
║    simulate             Run agents through app screens        ║
║    simulate --agent N   One agent, all screens               ║
║    simulate --screen X  All agents, one screen               ║
║    dropoff              Full drop-off lifecycle analysis      ║
║    children             Children experience simulation        ║
║    report               Generate analysis report              ║
║    report --format json Export as JSON                        ║
║                                                              ║
║  SETUP:                                                      ║
║    export ANTHROPIC_API_KEY=your_key_here                    ║
║    Place testing_agents.py in same directory                 ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
""")
        return

    cmd = sys.argv[1]

    # ---- ANALYZE ----
    if cmd == "analyze":
        print("\n  RLM PHASE 1: Partitioning 100 agents...")
        partitions = partition_agents(agents)
        for name, group in partitions.items():
            print(f"    {name}: {len(group)} agents")

        print(f"\n  RLM PHASE 2: Running {sum(1 for g in partitions.values() if g)} sub-agents...")
        for name, group in partitions.items():
            if not group:
                continue
            print(f"    Sub-agent: {name} ({len(group)} agents)...", end=" ", flush=True)
            result = run_sub_agent(name, group)
            results.save("analysis", f"{name}.json", result)
            mode = result.get("mode", "unknown")
            print(f"[{mode}]")

        print(f"\n  RLM PHASE 3: Root Agent synthesis...")
        synthesis = synthesize_results()
        print(f"    [{synthesis.get('mode', 'unknown')}]")
        print(f"\n  ✓ Analysis complete. Results in: {CONFIG['results_dir']}/")

    # ---- SIMULATE ----
    elif cmd == "simulate":
        agent_filter = None
        screen_filter = None

        if "--agent" in sys.argv:
            agent_filter = int(sys.argv[sys.argv.index("--agent") + 1])
        if "--screen" in sys.argv:
            screen_filter = sys.argv[sys.argv.index("--screen") + 1]

        target_agents = [agents[agent_filter - 1]] if agent_filter else agents
        target_screens = [screen_filter] if screen_filter else list(APP_SCREENS.keys())

        total = len(target_agents) * len(target_screens)
        print(f"\n  Simulating {len(target_agents)} agents × {len(target_screens)} screens = {total} simulations")
        print(f"  {'─' * 60}")

        count = 0
        for agent in target_agents:
            for screen_key in target_screens:
                count += 1
                print(f"  [{count}/{total}] {agent['id']} × {screen_key}...", end=" ", flush=True)
                result = simulate_agent_screen(agent, screen_key)
                if result:
                    results.save("simulations", f"{agent['id']}_{screen_key}.json", result)
                    print(f"[{result.get('mode', '?')}]")
                time.sleep(0.5)  # Rate limiting

        print(f"\n  ✓ Simulation complete. Results in: {CONFIG['results_dir']}/simulations/")

    # ---- DROPOFF ----
    elif cmd == "dropoff":
        lifecycle_screens = ["sms_invite", "app_store", "account_create", "record_linking",
                            "data_sharing", "family_invite", "dashboard_first",
                            "notification_day3", "quiet_day7", "child_mentions_day14",
                            "month1_review", "crisis_day90"]

        # Pick 10 diverse agents
        diverse = [agents[0], agents[9], agents[19], agents[29], agents[39],
                   agents[49], agents[59], agents[69], agents[79], agents[99]]

        total = len(diverse) * len(lifecycle_screens)
        print(f"\n  Drop-off analysis: {len(diverse)} agents × {len(lifecycle_screens)} lifecycle stages = {total}")
        print(f"  {'─' * 60}")

        count = 0
        for agent in diverse:
            for screen_key in lifecycle_screens:
                count += 1
                print(f"  [{count}/{total}] {agent['id']} × {screen_key}...", end=" ", flush=True)
                result = simulate_agent_screen(agent, screen_key)
                if result:
                    results.save("dropoff", f"{agent['id']}_{screen_key}.json", result)
                    print(f"[{result.get('mode', '?')}]")
                time.sleep(0.5)

        print(f"\n  ✓ Drop-off analysis complete. Results in: {CONFIG['results_dir']}/dropoff/")

    # ---- CHILDREN ----
    elif cmd == "children":
        child_screen_keys = list(CHILD_SCREENS.keys())
        with_children = [a for a in agents if a["family"]["children_count"] > 0][:15]

        total = len(with_children) * len(child_screen_keys)
        print(f"\n  Children simulation: {len(with_children)} parents × {len(child_screen_keys)} screens = {total}")
        print(f"  {'─' * 60}")

        count = 0
        for agent in with_children:
            for screen_key in child_screen_keys:
                count += 1
                child = agent["family"]["children"][0]
                print(f"  [{count}/{total}] Child of {agent['id']} in {child['location']} × {screen_key}...", end=" ", flush=True)
                result = simulate_child(agent, screen_key)
                if result:
                    results.save("children", f"child_{agent['id']}_{screen_key}.json", result)
                    print(f"[{result.get('mode', '?')}]")
                time.sleep(0.5)

        print(f"\n  ✓ Children simulation complete. Results in: {CONFIG['results_dir']}/children/")

    # ---- REPORT ----
    elif cmd == "report":
        fmt = "md"
        if "--format" in sys.argv:
            fmt = sys.argv[sys.argv.index("--format") + 1]
        generate_report(fmt)

    else:
        print(f"  Unknown command: {cmd}")
        print(f"  Run without arguments to see available commands.")


if __name__ == "__main__":
    main()

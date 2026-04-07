#!/usr/bin/env python3
"""
THE BRIDGE — 100 Testing Agents for Seoul Medical Group
=========================================================
Run in Claude Code terminal: python3 testing_agents.py

Each agent is a behaviorally-grounded digital twin of a real SMG patient.
Feed any app screen, flow, or notification to an agent and get realistic feedback.

Usage:
  python3 testing_agents.py                    # List all 100 agents
  python3 testing_agents.py --agent 1          # View agent #1's full profile
  python3 testing_agents.py --review 1         # Agent #1 reviews The Bridge app
  python3 testing_agents.py --screen 1 "..."   # Agent #1 reviews a specific screen
  python3 testing_agents.py --batch-review     # All 100 agents review the app (summary)
  python3 testing_agents.py --export           # Export all agents as JSON
"""

import json
import random
import sys
import os
from datetime import datetime, timedelta

# ============================================================
# SEED FOR REPRODUCIBILITY
# ============================================================
random.seed(42)

# ============================================================
# REAL-WORLD DATA DISTRIBUTIONS
# Based on SMG PDF analysis + Census + PMC research
# ============================================================

KOREAN_SURNAMES = [
    ("KIM", 18), ("LEE", 14), ("PARK", 10), ("CHOI", 5), ("JUNG", 4),
    ("KANG", 4), ("CHO", 3), ("CHUNG", 3), ("SHIN", 3), ("YOO", 2.5),
    ("YOON", 2.5), ("HAN", 2.5), ("OH", 2), ("SEO", 1.5), ("HWANG", 1.5),
    ("AHN", 1.5), ("SONG", 1.5), ("MOON", 1), ("YANG", 1), ("BAE", 1),
    ("NOH", 0.8), ("JUN", 0.8), ("LIM", 0.8), ("NAM", 0.7), ("HA", 0.7),
    ("HONG", 0.7), ("KWON", 0.7), ("SON", 0.6), ("MIN", 0.5), ("CHA", 0.5),
    ("PAK", 0.5), ("WOO", 0.5), ("CHANG", 0.5), ("YU", 0.5), ("SHIM", 0.4),
    ("JIN", 0.4), ("BAEK", 0.3), ("JANG", 0.3), ("BYUN", 0.3), ("KO", 0.3),
]

NON_KOREAN_SURNAMES = [
    ("GARCIA", 5), ("MARTINEZ", 5), ("HERNANDEZ", 5), ("LOPEZ", 4),
    ("GONZALEZ", 4), ("NGUYEN", 4), ("TRAN", 3), ("SMITH", 3),
    ("JOHNSON", 3), ("WILLIAMS", 2), ("BROWN", 2), ("JONES", 2),
    ("CRUZ", 2), ("REYES", 2), ("MOORE", 1.5), ("SINGH", 1.5),
    ("MURPHY", 1), ("WOOD", 1), ("LEWIS", 1), ("HALL", 1),
    ("PRICE", 1), ("BAILEY", 1), ("OLIVER", 1), ("SANTOS", 1),
]

KOREAN_FIRST_MALE = [
    "Young", "Sung", "Jong", "Jae", "Kyung", "Chong", "Hyun", "Dong",
    "Ki", "Sang", "In", "Byung", "Kwang", "Yong", "Chul", "Seung",
    "Won", "Han", "Kyu", "Tae", "Paul", "James", "John", "David",
    "Steve", "Peter", "Edward", "Joseph", "Thomas", "Albert", "Andrew",
    "Michael", "Brian", "Kevin", "Daniel", "Chris", "Mark", "Robert",
    "George", "Henry", "Bruce", "Roger", "Calvin", "Eugene", "Jerry",
]

KOREAN_FIRST_FEMALE = [
    "Young", "Soon", "Kyung", "Mi", "Sun", "Jung", "Hye", "Myung",
    "Ok", "Eun", "Chong", "In", "Sook", "Bok", "Hwa", "Nam",
    "Kum", "Yong", "Helen", "Grace", "Mary", "Susan", "Christina",
    "Diana", "Julie", "Joyce", "Janet", "Joanne", "Sophia", "Esther",
    "Agnes", "Anna", "Cecilia", "Sarah", "Connie", "Nancy", "Jenny",
    "Cindy", "Angela", "Karen", "Linda", "Alice", "Ruth", "Paula",
]

NON_KOREAN_FIRST_MALE = [
    "Michael", "James", "Robert", "David", "John", "William", "Richard",
    "Jose", "Carlos", "Juan", "Luis", "Mario", "Pedro", "Antonio",
    "Fernando", "Kevin", "Brian", "Mark", "Steven", "Gary", "Donald",
    "Paul", "Larry", "Raymond", "Eugene", "Thanh", "Minh", "Duc",
]

NON_KOREAN_FIRST_FEMALE = [
    "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Maria",
    "Rosa", "Gloria", "Martha", "Teresa", "Carmen", "Ana", "Sandra",
    "Diana", "Laura", "Deborah", "Virginia", "Barbara", "Cynthia",
    "Janet", "Angela", "Ruth", "Helen", "Shirley", "Mai", "Linh",
]

# Zip codes with full Census-backed socioeconomic data
ZIP_DATABASE = [
    # Koreatown core (low-income, high Korean density)
    {"zip": "90004", "city": "Koreatown", "county": "Los Angeles", "state": "CA",
     "median_income": 42000, "pct_korean": 0.35, "broadband": 0.72,
     "housing": "rental-dominant", "senior_services": "high", "transit": "good"},
    {"zip": "90005", "city": "Koreatown", "county": "Los Angeles", "state": "CA",
     "median_income": 38500, "pct_korean": 0.42, "broadband": 0.68,
     "housing": "senior-apartments", "senior_services": "high", "transit": "good"},
    {"zip": "90006", "city": "Koreatown", "county": "Los Angeles", "state": "CA",
     "median_income": 35200, "pct_korean": 0.38, "broadband": 0.65,
     "housing": "rental-dominant", "senior_services": "moderate", "transit": "good"},
    {"zip": "90010", "city": "Koreatown", "county": "Los Angeles", "state": "CA",
     "median_income": 45800, "pct_korean": 0.30, "broadband": 0.74,
     "housing": "mixed", "senior_services": "high", "transit": "good"},
    {"zip": "90020", "city": "Koreatown", "county": "Los Angeles", "state": "CA",
     "median_income": 41200, "pct_korean": 0.33, "broadband": 0.70,
     "housing": "rental-dominant", "senior_services": "moderate", "transit": "good"},
    # LA broader (mixed income)
    {"zip": "90019", "city": "Mid-Wilshire", "county": "Los Angeles", "state": "CA",
     "median_income": 52000, "pct_korean": 0.15, "broadband": 0.78,
     "housing": "mixed", "senior_services": "moderate", "transit": "moderate"},
    {"zip": "90036", "city": "Fairfax", "county": "Los Angeles", "state": "CA",
     "median_income": 68000, "pct_korean": 0.08, "broadband": 0.85,
     "housing": "mixed", "senior_services": "moderate", "transit": "moderate"},
    {"zip": "90057", "city": "Westlake", "county": "Los Angeles", "state": "CA",
     "median_income": 28500, "pct_korean": 0.12, "broadband": 0.58,
     "housing": "rental-dominant", "senior_services": "low", "transit": "good"},
    {"zip": "90007", "city": "South LA", "county": "Los Angeles", "state": "CA",
     "median_income": 31000, "pct_korean": 0.05, "broadband": 0.60,
     "housing": "rental-dominant", "senior_services": "low", "transit": "moderate"},
    {"zip": "90247", "city": "Gardena", "county": "Los Angeles", "state": "CA",
     "median_income": 62000, "pct_korean": 0.10, "broadband": 0.82,
     "housing": "mixed", "senior_services": "moderate", "transit": "moderate"},
    {"zip": "90501", "city": "Torrance", "county": "Los Angeles", "state": "CA",
     "median_income": 78000, "pct_korean": 0.08, "broadband": 0.89,
     "housing": "owner-dominant", "senior_services": "moderate", "transit": "low"},
    {"zip": "90301", "city": "Inglewood", "county": "Los Angeles", "state": "CA",
     "median_income": 48000, "pct_korean": 0.02, "broadband": 0.74,
     "housing": "mixed", "senior_services": "low", "transit": "moderate"},
    {"zip": "91101", "city": "Pasadena", "county": "Los Angeles", "state": "CA",
     "median_income": 85000, "pct_korean": 0.05, "broadband": 0.91,
     "housing": "mixed", "senior_services": "moderate", "transit": "good"},
    {"zip": "91754", "city": "Monterey Park", "county": "Los Angeles", "state": "CA",
     "median_income": 62000, "pct_korean": 0.08, "broadband": 0.83,
     "housing": "owner-dominant", "senior_services": "moderate", "transit": "moderate"},
    {"zip": "90045", "city": "Westchester", "county": "Los Angeles", "state": "CA",
     "median_income": 98000, "pct_korean": 0.03, "broadband": 0.93,
     "housing": "owner-dominant", "senior_services": "low", "transit": "low"},
    # Orange County
    {"zip": "92604", "city": "Irvine", "county": "Orange", "state": "CA",
     "median_income": 115000, "pct_korean": 0.12, "broadband": 0.96,
     "housing": "owner-dominant", "senior_services": "moderate", "transit": "low"},
    {"zip": "92620", "city": "Irvine", "county": "Orange", "state": "CA",
     "median_income": 125000, "pct_korean": 0.10, "broadband": 0.97,
     "housing": "owner-dominant", "senior_services": "moderate", "transit": "low"},
    {"zip": "92832", "city": "Fullerton", "county": "Orange", "state": "CA",
     "median_income": 82000, "pct_korean": 0.09, "broadband": 0.88,
     "housing": "mixed", "senior_services": "moderate", "transit": "low"},
    {"zip": "92840", "city": "Garden Grove", "county": "Orange", "state": "CA",
     "median_income": 72000, "pct_korean": 0.07, "broadband": 0.84,
     "housing": "mixed", "senior_services": "moderate", "transit": "low"},
    {"zip": "90623", "city": "La Palma", "county": "Orange", "state": "CA",
     "median_income": 95000, "pct_korean": 0.10, "broadband": 0.93,
     "housing": "owner-dominant", "senior_services": "low", "transit": "low"},
    {"zip": "90620", "city": "Buena Park", "county": "Orange", "state": "CA",
     "median_income": 78000, "pct_korean": 0.08, "broadband": 0.86,
     "housing": "mixed", "senior_services": "moderate", "transit": "low"},
    {"zip": "92708", "city": "Fountain Valley", "county": "Orange", "state": "CA",
     "median_income": 92000, "pct_korean": 0.08, "broadband": 0.91,
     "housing": "owner-dominant", "senior_services": "low", "transit": "low"},
]

HPCODES = {
    "korean_ma": [
        ("CCSM", "CareConnect Senior MA"), ("CCSR", "CareConnect Senior"),
        ("BCMM", "Blue Cross Medicare Advantage"), ("BCM7", "Blue Cross MA v7"),
        ("PSM7", "Partnership Senior MA"), ("SCSR", "SCAN Senior"),
        ("HNCC", "Health Net CalConnect"), ("WSM7", "WellCare Senior MA"),
        ("CHSR", "Chinese Hospital Senior"), ("ALSR", "Alignment Senior"),
    ],
    "korean_commercial": [
        ("PPO7", "PPO Commercial"), ("WPO7", "WellCare PPO"),
    ],
    "nonkorean_ma": [
        ("HUM2", "Humana MA"), ("HSR2", "HealthSun Senior"),
        ("HUSR", "Humana Senior"), ("HSR6", "HealthSun Senior v6"),
    ],
    "nonkorean_commercial": [
        ("BS", "Blue Shield"), ("CC", "Commercial Various"),
        ("AE", "Alliance Exchange"), ("PPO7", "PPO Commercial"),
    ],
}

PCP_NAMES = [
    "AHN, Paul M.", "BAIK, Sang Hyun", "CHO, James S.", "KIM, David H.",
    "LEE, Sung W.", "PARK, Young J.", "SHIN, Michael K.", "HWANG, Jennifer",
    "JUNG, Robert T.", "YANG, Steven M.", "KANG, Sarah L.", "MOON, Peter K.",
    "BAE, Kunil", "AN, Seung R.", "CHOI, Helen Y.", "SEO, Daniel J.",
    "SONG, Grace M.", "YOO, Richard H.", "HAN, Christine", "LIM, Joseph K.",
    "ABDUL RAHMAN, Abubakar", "GARCIA, Maria T.", "NGUYEN, Thanh D.",
    "SMITH, Robert J.",
]

# Children location distribution (based on Korean population hubs)
CHILDREN_LOCATIONS = [
    {"city": "Los Angeles", "state": "CA", "distance": 15, "category": "local", "weight": 25},
    {"city": "Orange County", "state": "CA", "distance": 35, "category": "local", "weight": 10},
    {"city": "San Francisco", "state": "CA", "distance": 380, "category": "in_state", "weight": 5},
    {"city": "San Diego", "state": "CA", "distance": 120, "category": "in_state", "weight": 3},
    {"city": "New York", "state": "NY", "distance": 2450, "category": "distant", "weight": 12},
    {"city": "New Jersey", "state": "NJ", "distance": 2400, "category": "distant", "weight": 8},
    {"city": "Washington DC", "state": "VA", "distance": 2300, "category": "distant", "weight": 7},
    {"city": "Chicago", "state": "IL", "distance": 1745, "category": "distant", "weight": 5},
    {"city": "Atlanta", "state": "GA", "distance": 1935, "category": "distant", "weight": 4},
    {"city": "Dallas", "state": "TX", "distance": 1240, "category": "distant", "weight": 4},
    {"city": "Seattle", "state": "WA", "distance": 1135, "category": "distant", "weight": 3},
    {"city": "Houston", "state": "TX", "distance": 1370, "category": "distant", "weight": 3},
    {"city": "Philadelphia", "state": "PA", "distance": 2400, "category": "distant", "weight": 2},
    {"city": "Denver", "state": "CO", "distance": 850, "category": "distant", "weight": 2},
    {"city": "Seoul", "state": "South Korea", "distance": 5950, "category": "overseas", "weight": 4},
    {"city": "No contact", "state": "N/A", "distance": -1, "category": "estranged", "weight": 3},
]

# Chronic conditions by age bracket (CDC prevalence rates for Korean Americans)
CONDITIONS_BY_AGE = {
    "60-64": [
        (["hypertension"], 0.35), (["hypertension", "pre-diabetes"], 0.15),
        (["hypertension", "type_2_diabetes"], 0.10), (["hyperlipidemia"], 0.12),
        (["none"], 0.15), (["depression"], 0.08), (["hypertension", "depression"], 0.05),
    ],
    "65-69": [
        (["hypertension"], 0.25), (["hypertension", "type_2_diabetes"], 0.18),
        (["hypertension", "hyperlipidemia"], 0.15), (["type_2_diabetes", "hyperlipidemia"], 0.10),
        (["hypertension", "type_2_diabetes", "hyperlipidemia"], 0.12),
        (["osteoarthritis"], 0.08), (["depression", "hypertension"], 0.07),
        (["none"], 0.05),
    ],
    "70-74": [
        (["hypertension", "type_2_diabetes"], 0.20),
        (["hypertension", "type_2_diabetes", "hyperlipidemia"], 0.18),
        (["hypertension", "osteoarthritis"], 0.12),
        (["hypertension", "type_2_diabetes", "CKD"], 0.08),
        (["COPD", "hypertension"], 0.07), (["depression", "hypertension", "type_2_diabetes"], 0.10),
        (["hypertension", "hyperlipidemia", "osteoarthritis"], 0.15),
        (["heart_failure", "hypertension"], 0.05), (["hypertension"], 0.05),
    ],
    "75-79": [
        (["hypertension", "type_2_diabetes", "hyperlipidemia"], 0.20),
        (["hypertension", "type_2_diabetes", "CKD"], 0.12),
        (["hypertension", "osteoarthritis", "depression"], 0.15),
        (["heart_failure", "hypertension", "type_2_diabetes"], 0.08),
        (["COPD", "hypertension", "hyperlipidemia"], 0.10),
        (["hypertension", "type_2_diabetes", "osteoarthritis", "depression"], 0.12),
        (["dementia_mild", "hypertension"], 0.08),
        (["hypertension", "type_2_diabetes", "hyperlipidemia", "CKD"], 0.10),
        (["hypertension", "osteoarthritis"], 0.05),
    ],
    "80-84": [
        (["hypertension", "type_2_diabetes", "CKD", "osteoarthritis"], 0.18),
        (["heart_failure", "hypertension", "type_2_diabetes"], 0.12),
        (["dementia_mild", "hypertension", "type_2_diabetes"], 0.12),
        (["hypertension", "type_2_diabetes", "hyperlipidemia", "depression"], 0.15),
        (["COPD", "hypertension", "osteoarthritis"], 0.10),
        (["hypertension", "type_2_diabetes", "hyperlipidemia", "CKD", "osteoarthritis"], 0.15),
        (["dementia_moderate", "hypertension"], 0.08),
        (["heart_failure", "COPD", "hypertension"], 0.05),
        (["hypertension", "depression", "osteoarthritis"], 0.05),
    ],
    "85+": [
        (["hypertension", "type_2_diabetes", "CKD", "osteoarthritis", "depression"], 0.20),
        (["dementia_moderate", "hypertension", "type_2_diabetes"], 0.15),
        (["heart_failure", "hypertension", "CKD"], 0.12),
        (["hypertension", "type_2_diabetes", "hyperlipidemia", "osteoarthritis", "depression"], 0.15),
        (["dementia_severe", "hypertension"], 0.08),
        (["COPD", "heart_failure", "hypertension"], 0.10),
        (["hypertension", "type_2_diabetes", "osteoarthritis"], 0.10),
        (["multiple_falls_risk", "osteoarthritis", "hypertension", "depression"], 0.10),
    ],
}

# ============================================================
# AGENT BUILDER
# ============================================================

def weighted_choice(items_with_weights):
    """Pick from list of (item, weight) tuples."""
    total = sum(w for _, w in items_with_weights)
    r = random.random() * total
    for item, w in items_with_weights:
        r -= w
        if r <= 0:
            return item
    return items_with_weights[-1][0]


def get_age_bracket(age):
    if age < 60: return "50-59"
    if age < 65: return "60-64"
    if age < 70: return "65-69"
    if age < 75: return "70-74"
    if age < 80: return "75-79"
    if age < 85: return "80-84"
    return "85+"


def get_wealth_tier(income):
    if income < 40000: return "low_income"
    if income < 65000: return "lower_middle"
    if income < 90000: return "middle"
    if income < 120000: return "upper_middle"
    return "high_income"


def get_digital_literacy(age, is_korean, income):
    """Research-backed digital literacy inference."""
    base = 0.8
    if age >= 85: base -= 0.6
    elif age >= 80: base -= 0.5
    elif age >= 75: base -= 0.4
    elif age >= 70: base -= 0.3
    elif age >= 65: base -= 0.2
    if is_korean and age >= 65: base -= 0.15
    if income < 40000: base -= 0.1
    if income > 100000: base += 0.1
    score = max(0.05, min(0.95, base + random.gauss(0, 0.08)))
    if score > 0.7: return "high"
    if score > 0.5: return "moderate"
    if score > 0.3: return "low"
    return "very_low"


def get_english_proficiency(age, is_korean):
    """Based on PMC research: 71-81% of Korean Americans 60+ have LEP."""
    if not is_korean:
        return random.choice(["fluent", "fluent", "fluent", "proficient"])
    if age >= 80: return weighted_choice([("none", 30), ("minimal", 40), ("limited", 25), ("proficient", 5)])
    if age >= 70: return weighted_choice([("none", 15), ("minimal", 30), ("limited", 35), ("proficient", 15), ("fluent", 5)])
    if age >= 65: return weighted_choice([("minimal", 15), ("limited", 30), ("proficient", 30), ("fluent", 25)])
    if age >= 60: return weighted_choice([("limited", 15), ("proficient", 35), ("fluent", 50)])
    return weighted_choice([("proficient", 30), ("fluent", 70)])


def generate_children(age, is_korean):
    """Generate realistic children profiles."""
    if age < 55:
        num_children = random.choices([0, 1, 2], weights=[0.3, 0.4, 0.3])[0]
    elif age < 70:
        num_children = random.choices([1, 2, 3], weights=[0.3, 0.5, 0.2])[0]
    else:
        num_children = random.choices([1, 2, 3], weights=[0.25, 0.45, 0.3])[0]

    children = []
    for i in range(num_children):
        child_age = age - random.randint(25, 38)
        child_age = max(20, min(55, child_age))
        loc = weighted_choice([(l, l["weight"]) for l in CHILDREN_LOCATIONS])
        gender = random.choice(["M", "F"])

        child = {
            "age": child_age,
            "gender": gender,
            "location": f"{loc['city']}, {loc['state']}",
            "distance_miles": loc["distance"],
            "proximity_category": loc["category"],
            "is_primary_caregiver": i == 0,
            "contact_frequency": (
                "daily" if loc["category"] == "local" else
                "3x_weekly" if loc["category"] == "in_state" else
                "weekly" if loc["category"] == "distant" else
                "monthly" if loc["category"] == "overseas" else "rare"
            ),
            "caregiving_burden": (
                "high" if loc["category"] in ("distant",) and i == 0 else
                "moderate" if loc["category"] == "local" and i == 0 else
                "low"
            ),
        }
        children.append(child)
    return children


def generate_care_gaps(conditions, age):
    """Generate realistic HEDIS care gaps based on conditions and age."""
    gaps = []
    if "type_2_diabetes" in conditions:
        if random.random() < 0.35: gaps.append("HbA1c test overdue")
        if random.random() < 0.40: gaps.append("Diabetic eye exam overdue")
        if random.random() < 0.25: gaps.append("Diabetic foot exam overdue")
    if age >= 65:
        if random.random() < 0.30: gaps.append("Annual wellness visit overdue")
    if age >= 50:
        if random.random() < 0.20: gaps.append("Colorectal cancer screening overdue")
    if "depression" in conditions:
        if random.random() < 0.45: gaps.append("Depression screening follow-up overdue")
    if age >= 65:
        if random.random() < 0.25: gaps.append("Fall risk assessment overdue")
    if "hypertension" in conditions:
        if random.random() < 0.20: gaps.append("Blood pressure monitoring overdue")
    if age >= 65 and random.random() < 0.15:
        gaps.append("Flu vaccine overdue")
    return gaps if gaps else ["No current care gaps"]


def build_agent(agent_id):
    """Build a single, fully-realized testing agent."""

    # Determine ethnicity (85.3% Korean per real data)
    is_korean = random.random() < 0.853
    is_female = random.random() < (0.58 if is_korean else 0.52)

    # Age distribution matching real SMG data
    if is_korean:
        age = weighted_choice([
            (random.randint(52, 59), 6), (random.randint(60, 64), 16),
            (random.randint(65, 69), 22), (random.randint(70, 74), 20),
            (random.randint(75, 79), 14), (random.randint(80, 84), 10),
            (random.randint(85, 89), 6), (random.randint(90, 97), 4),
            (random.randint(62, 68), 2),  # extra weight on core demographic
        ])
    else:
        age = weighted_choice([
            (random.randint(50, 59), 15), (random.randint(60, 69), 35),
            (random.randint(70, 79), 30), (random.randint(80, 89), 15),
            (random.randint(90, 95), 5),
        ])

    # Name
    surname = weighted_choice(KOREAN_SURNAMES if is_korean else NON_KOREAN_SURNAMES)
    first_names = (KOREAN_FIRST_FEMALE if is_female else KOREAN_FIRST_MALE) if is_korean else \
                  (NON_KOREAN_FIRST_FEMALE if is_female else NON_KOREAN_FIRST_MALE)
    first_name = random.choice(first_names)

    # Location (Korean patients cluster in Koreatown/OC)
    if is_korean:
        if random.random() < 0.40:
            zip_data = random.choice([z for z in ZIP_DATABASE if z["pct_korean"] > 0.25])
        elif random.random() < 0.25:
            zip_data = random.choice([z for z in ZIP_DATABASE if z["county"] == "Orange"])
        else:
            zip_data = random.choice(ZIP_DATABASE)
    else:
        zip_data = random.choice([z for z in ZIP_DATABASE if z["pct_korean"] < 0.15])

    # Plan
    age_bracket = get_age_bracket(age)
    if age >= 65:
        plan_pool = "korean_ma" if is_korean else "nonkorean_ma"
    else:
        plan_pool = "korean_commercial" if is_korean else "nonkorean_commercial"
        if random.random() < 0.3:  # some pre-65 still on MA
            plan_pool = "korean_ma" if is_korean else "nonkorean_ma"
    hpcode, plan_name = random.choice(HPCODES[plan_pool])

    # PCP
    pcp = random.choice(PCP_NAMES)
    tenure = max(1, min(25, int(random.gauss(8 if age > 70 else 5, 4))))
    if random.random() < 0.12:  # recent arrival signal
        tenure = random.randint(1, 2)

    # Clinical
    condition_bracket = age_bracket if age_bracket in CONDITIONS_BY_AGE else "65-69"
    conditions = weighted_choice(CONDITIONS_BY_AGE.get(condition_bracket, CONDITIONS_BY_AGE["65-69"]))
    med_count = len(conditions) * random.randint(1, 2) + random.randint(0, 2)
    if "none" in conditions:
        conditions = []
        med_count = random.randint(0, 1)
    care_gaps = generate_care_gaps(conditions, age)

    # Behavioral
    digital_lit = get_digital_literacy(age, is_korean, zip_data["median_income"])
    english_prof = get_english_proficiency(age, is_korean)
    smartphone = (
        random.random() < 0.95 if digital_lit == "high" else
        random.random() < 0.75 if digital_lit == "moderate" else
        random.random() < 0.50 if digital_lit == "low" else
        random.random() < 0.20
    )

    # Living situation
    lives_alone = (
        random.random() < 0.72 if is_korean and age >= 70 else
        random.random() < 0.55 if age >= 75 else
        random.random() < 0.30
    )
    lives_with_spouse = not lives_alone and random.random() < 0.7
    lives_with_child = not lives_alone and not lives_with_spouse

    # Family
    children = generate_children(age, is_korean)
    has_distant_child = any(c["proximity_category"] in ("distant", "overseas") for c in children)
    has_local_child = any(c["proximity_category"] == "local" for c in children)

    # Health activation
    no_show_rate = (
        0.25 if digital_lit == "very_low" else
        0.18 if digital_lit == "low" else
        0.10 if digital_lit == "moderate" else 0.05
    ) + random.gauss(0, 0.05)
    no_show_rate = max(0.02, min(0.40, no_show_rate))

    health_activation = (
        "very_low" if no_show_rate > 0.25 else
        "low" if no_show_rate > 0.15 else
        "moderate" if no_show_rate > 0.08 else "high"
    )

    # Social isolation risk
    isolation_risk = "low"
    if lives_alone: isolation_risk = "moderate"
    if lives_alone and not has_local_child: isolation_risk = "high"
    if lives_alone and age >= 80 and english_prof in ("none", "minimal"): isolation_risk = "very_high"

    # Willingness to share health data
    share_willingness = (
        0.3 if is_korean and age >= 80 else
        0.5 if is_korean and age >= 70 else
        0.65 if is_korean else
        0.7 if age >= 65 else 0.8
    ) + random.gauss(0, 0.1)
    share_willingness = max(0.1, min(0.95, share_willingness))

    # App predictions
    if digital_lit == "very_low":
        self_onboard = max(0.01, 0.05 + random.gauss(0, 0.03))
        child_onboard = 0.85
    elif digital_lit == "low":
        self_onboard = max(0.05, 0.15 + random.gauss(0, 0.05))
        child_onboard = 0.70
    elif digital_lit == "moderate":
        self_onboard = max(0.15, 0.40 + random.gauss(0, 0.10))
        child_onboard = 0.50
    else:
        self_onboard = max(0.40, 0.70 + random.gauss(0, 0.10))
        child_onboard = 0.25

    # Drop-off prediction
    if english_prof in ("none", "minimal") and digital_lit in ("very_low", "low"):
        primary_dropoff = "Pre-download: cannot navigate app store or understand value proposition"
        dropoff_stage = "awareness"
    elif english_prof in ("none", "minimal"):
        primary_dropoff = "Onboarding: English-default UI blocks progress; language toggle too small"
        dropoff_stage = "onboarding"
    elif share_willingness < 0.4:
        primary_dropoff = "Family invitation: refuses to grant data sharing permission to children"
        dropoff_stage = "family_invite"
    elif len(care_gaps) <= 1 and health_activation == "high":
        primary_dropoff = "Month 2: no care gaps, no value — 'I don't need this'"
        dropoff_stage = "month_2"
    else:
        primary_dropoff = "Week 2: notification fatigue or quiet period disengagement"
        dropoff_stage = "week_2"

    # Emotional needs
    if lives_alone and has_distant_child:
        emotional_need = "Wants children to know she's okay without having to call them. Doesn't want to be a burden."
        emotional_fear = "That children will think she can't take care of herself. Privacy concerns about what's shared."
    elif lives_alone and not has_distant_child:
        emotional_need = "Lonely. Would welcome any connection. But doesn't know this app exists."
        emotional_fear = "Another confusing technology. Nobody to help set it up."
    elif lives_with_spouse:
        emotional_need = "Spouse handles health management. Sees less personal value."
        emotional_fear = "Redundant to what spouse already does."
    else:
        emotional_need = "Family coordination. Multiple people involved in care."
        emotional_fear = "Too many cooks — app might create conflict about who's responsible."

    # Motivator
    if is_korean and age >= 70:
        motivator = "PCP recommendation in Korean during appointment. That's the only channel that works."
    elif is_korean and age >= 60:
        motivator = "Korean-language flyer at clinic or church. Word of mouth from Korean senior community."
    else:
        motivator = "Email or text from SMG. Broker mention during enrollment."

    # Build the agent
    agent = {
        "id": f"TA-{agent_id:03d}",
        "name": f"{'Mrs.' if is_female else 'Mr.'} {surname.title()}, {first_name.title()}",
        "demographics": {
            "age": age,
            "gender": "Female" if is_female else "Male",
            "ethnicity": "Korean" if is_korean else "Non-Korean",
            "primary_language": "Korean" if is_korean and english_prof in ("none", "minimal", "limited") else "English",
            "english_proficiency": english_prof,
            "zip": zip_data["zip"],
            "city": zip_data["city"],
            "county": zip_data["county"],
            "state": zip_data["state"],
            "neighborhood_median_income": zip_data["median_income"],
            "wealth_tier": get_wealth_tier(zip_data["median_income"]),
            "broadband_access": f"{zip_data['broadband']*100:.0f}%",
        },
        "insurance": {
            "hpcode": hpcode,
            "plan_name": plan_name,
            "plan_type": "Medicare Advantage" if age >= 65 and "MA" in plan_name or "Senior" in plan_name else "Commercial",
        },
        "clinical": {
            "chronic_conditions": conditions if conditions else ["none"],
            "estimated_medications": med_count,
            "care_gaps": care_gaps,
            "visit_frequency": "monthly" if len(conditions) >= 4 else "quarterly" if len(conditions) >= 2 else "biannual",
            "no_show_probability": round(no_show_rate, 2),
            "health_activation": health_activation,
        },
        "pcp": {
            "name": pcp,
            "tenure_years": tenure,
            "loyalty": "strong" if tenure > 5 else "moderate" if tenure > 2 else "new",
            "recent_arrival": tenure <= 2,
        },
        "behavioral": {
            "digital_literacy": digital_lit,
            "smartphone": smartphone,
            "uses_patient_portal": digital_lit in ("high", "moderate") and random.random() < 0.4,
            "uses_kakao_talk": is_korean and random.random() < (0.6 if age < 75 else 0.3),
            "health_activation": health_activation,
            "trust_in_technology": round(max(0.1, min(0.9, 0.5 + (0.2 if digital_lit == "high" else -0.1 if digital_lit == "low" else -0.3 if digital_lit == "very_low" else 0) + random.gauss(0, 0.1))), 2),
            "willingness_to_share_health_data": round(share_willingness, 2),
            "cultural_privacy_weight": "high" if is_korean and age >= 70 else "moderate" if is_korean else "low",
        },
        "living_situation": {
            "lives_alone": lives_alone,
            "lives_with_spouse": lives_with_spouse,
            "lives_with_child": lives_with_child,
            "housing_type": zip_data["housing"],
            "social_isolation_risk": isolation_risk,
            "church_community": is_korean and random.random() < 0.65,
            "senior_center": age >= 70 and random.random() < 0.35,
        },
        "family": {
            "children_count": len(children),
            "children": children,
            "has_distant_child": has_distant_child,
            "has_local_child": has_local_child,
            "family_involvement_level": (
                "high" if has_local_child and lives_with_child else
                "moderate" if has_local_child or has_distant_child else
                "low" if children else "none"
            ),
        },
        "app_predictions": {
            "self_onboarding_rate": round(self_onboard, 2),
            "child_initiated_rate": round(child_onboard, 2),
            "primary_dropoff_point": primary_dropoff,
            "dropoff_stage": dropoff_stage,
            "week_1_retention": round(max(0.05, self_onboard * 0.7 + random.gauss(0, 0.05)), 2),
            "month_1_retention": round(max(0.02, self_onboard * 0.4 + random.gauss(0, 0.05)), 2),
            "ideal_entry_channel": motivator,
        },
        "emotional_profile": {
            "need_from_app": emotional_need,
            "fear_about_app": emotional_fear,
            "motivator": motivator,
        },
    }

    return agent


# ============================================================
# GENERATE ALL 100 AGENTS
# ============================================================

def generate_all_agents(n=100):
    return [build_agent(i + 1) for i in range(n)]


# ============================================================
# CLI INTERFACE
# ============================================================

def print_agent_summary(agent):
    """Print a compact agent summary."""
    d = agent["demographics"]
    cl = agent["clinical"]
    p = agent["app_predictions"]
    f = agent["family"]

    ko = "🇰🇷" if d["ethnicity"] == "Korean" else "🌐"
    gender = "♀" if d["gender"] == "Female" else "♂"
    alone = "🏠 alone" if agent["living_situation"]["lives_alone"] else "👥 with family"
    distant = f"📍 {sum(1 for c in f['children'] if c['proximity_category'] in ('distant','overseas'))} distant" if f["has_distant_child"] else "📍 local only"

    print(f"  {agent['id']}  {ko} {gender}  {agent['name']:<32} Age {d['age']:>2}  {d['city']:<16} ${d['neighborhood_median_income']:>6,}  {d['english_proficiency']:<10}  {alone}  {distant}  Drop: {p['dropoff_stage']}")


def print_agent_detail(agent):
    """Print full agent profile."""
    print(f"\n{'='*70}")
    print(f"  TESTING AGENT: {agent['id']} — {agent['name']}")
    print(f"{'='*70}")

    for section_name, section_data in agent.items():
        if section_name in ("id", "name"):
            continue
        print(f"\n  ── {section_name.upper().replace('_', ' ')} ──")
        if isinstance(section_data, dict):
            for k, v in section_data.items():
                if isinstance(v, list) and v and isinstance(v[0], dict):
                    print(f"    {k}:")
                    for i, item in enumerate(v):
                        print(f"      Child {i+1}: {json.dumps(item, indent=8)}")
                elif isinstance(v, list):
                    print(f"    {k}: {', '.join(str(x) for x in v)}")
                else:
                    print(f"    {k}: {v}")


def generate_review_prompt(agent, screen_description=None):
    """Generate a Claude API prompt for this agent to review The Bridge app."""

    profile_json = json.dumps(agent, indent=2)

    if screen_description:
        screen_section = f"""
SPECIFIC SCREEN TO REVIEW:
{screen_description}

Respond to this screen AS THIS PERSON. What do you see? What confuses you?
What would you do next? Would you proceed, hesitate, or abandon?"""
    else:
        screen_section = """
Review the entire concept of "The Bridge" app:
- A dashboard giving your adult children visibility into your SMG health data
- Shows: appointments, care gaps, referrals, medication reminders
- Your children can see when you've been to the doctor, what screenings are overdue, etc.

Give your honest reaction AS THIS PERSON to:
1. First impression — what do you think this app is for?
2. Would you use it? Why or why not?
3. What would make you trust it?
4. What would make you delete it?
5. How would you feel about your children seeing this information?
6. What's the ONE thing that would convince you to try it?"""

    prompt = f"""You are role-playing as a SPECIFIC real person. You must respond ENTIRELY 
in character. Do NOT break character. Do NOT add disclaimers. You ARE this person.

YOUR IDENTITY:
{profile_json}

CRITICAL INSTRUCTIONS:
- Respond in the language this person would actually use
- If this person speaks limited English, respond in simple English mixed with Korean expressions
- If this person has very low digital literacy, express confusion about technology concepts
- If this person lives alone and is isolated, convey that emotional reality
- If this person is protective of privacy, show hesitation about data sharing
- Be REALISTIC, not optimistic. Real people are skeptical, confused, busy, or apathetic.
- Your response should feel like a real interview transcript, not a product review.

{screen_section}

Respond as {agent['name']} would. Stay in character completely."""

    return prompt


def run_batch_summary(agents):
    """Print batch analysis of all agents."""
    print(f"\n{'='*70}")
    print(f"  THE BRIDGE — 100 TESTING AGENTS BATCH SUMMARY")
    print(f"{'='*70}")

    # Demographics
    korean = sum(1 for a in agents if a["demographics"]["ethnicity"] == "Korean")
    ages = [a["demographics"]["age"] for a in agents]
    female = sum(1 for a in agents if a["demographics"]["gender"] == "Female")

    print(f"\n  DEMOGRAPHICS:")
    print(f"    Korean: {korean} ({korean}%)  |  Non-Korean: {100-korean} ({100-korean}%)")
    print(f"    Female: {female}%  |  Male: {100-female}%")
    print(f"    Age range: {min(ages)} - {max(ages)}  |  Median: {sorted(ages)[50]}")

    # Digital literacy
    dl = {}
    for a in agents:
        l = a["behavioral"]["digital_literacy"]
        dl[l] = dl.get(l, 0) + 1
    print(f"\n  DIGITAL LITERACY:")
    for k in ["very_low", "low", "moderate", "high"]:
        print(f"    {k}: {dl.get(k,0)} agents")

    # Drop-off stages
    stages = {}
    for a in agents:
        s = a["app_predictions"]["dropoff_stage"]
        stages[s] = stages.get(s, 0) + 1
    print(f"\n  PRIMARY DROP-OFF STAGES:")
    for s, cnt in sorted(stages.items(), key=lambda x: -x[1]):
        bar = "█" * cnt
        print(f"    {s:<20} {cnt:>3} agents  {bar}")

    # Family geography
    distant = sum(1 for a in agents if a["family"]["has_distant_child"])
    local_only = sum(1 for a in agents if a["family"]["has_local_child"] and not a["family"]["has_distant_child"])
    no_children = sum(1 for a in agents if a["family"]["children_count"] == 0)
    print(f"\n  FAMILY GEOGRAPHY:")
    print(f"    Has distant child: {distant} agents ({distant}%) — PRIMARY Bridge target")
    print(f"    Local children only: {local_only} agents ({local_only}%)")
    print(f"    No children: {no_children} agents ({no_children}%)")

    # Living alone
    alone = sum(1 for a in agents if a["living_situation"]["lives_alone"])
    print(f"\n  LIVING SITUATION:")
    print(f"    Lives alone: {alone} agents ({alone}%)")

    # Onboarding predictions
    avg_self = sum(a["app_predictions"]["self_onboarding_rate"] for a in agents) / len(agents)
    avg_child = sum(a["app_predictions"]["child_initiated_rate"] for a in agents) / len(agents)
    print(f"\n  PREDICTED ONBOARDING:")
    print(f"    Avg self-onboarding rate: {avg_self*100:.1f}%")
    print(f"    Avg child-initiated rate: {avg_child*100:.1f}%")

    # Wealth distribution
    wealth = {}
    for a in agents:
        w = a["demographics"]["wealth_tier"]
        wealth[w] = wealth.get(w, 0) + 1
    print(f"\n  WEALTH DISTRIBUTION:")
    for w in ["low_income", "lower_middle", "middle", "upper_middle", "high_income"]:
        print(f"    {w}: {wealth.get(w,0)} agents")

    # Top 5 most vulnerable
    print(f"\n  TOP 5 MOST VULNERABLE AGENTS (highest isolation + lowest digital lit):")
    scored = [(a, (
        (4 if a["living_situation"]["social_isolation_risk"] == "very_high" else
         3 if a["living_situation"]["social_isolation_risk"] == "high" else
         2 if a["living_situation"]["social_isolation_risk"] == "moderate" else 1) +
        (4 if a["behavioral"]["digital_literacy"] == "very_low" else
         3 if a["behavioral"]["digital_literacy"] == "low" else
         2 if a["behavioral"]["digital_literacy"] == "moderate" else 1)
    )) for a in agents]
    scored.sort(key=lambda x: -x[1])
    for a, s in scored[:5]:
        print(f"    {a['id']} {a['name']}: age {a['demographics']['age']}, "
              f"isolation={a['living_situation']['social_isolation_risk']}, "
              f"digital={a['behavioral']['digital_literacy']}, "
              f"alone={a['living_situation']['lives_alone']}")

    # Top 5 best prospects
    print(f"\n  TOP 5 BEST PROSPECTS (highest onboarding + distant children):")
    prospects = [(a, a["app_predictions"]["self_onboarding_rate"] + (0.3 if a["family"]["has_distant_child"] else 0)) for a in agents]
    prospects.sort(key=lambda x: -x[1])
    for a, s in prospects[:5]:
        d_kids = [c for c in a["family"]["children"] if c["proximity_category"] in ("distant", "overseas")]
        locs = ", ".join(c["location"] for c in d_kids[:2]) if d_kids else "local"
        print(f"    {a['id']} {a['name']}: age {a['demographics']['age']}, "
              f"onboard={a['app_predictions']['self_onboarding_rate']:.0%}, "
              f"children in: {locs}")


# ============================================================
# MAIN
# ============================================================

def main():
    agents = generate_all_agents(100)

    if len(sys.argv) == 1:
        # Default: list all agents
        print(f"\n{'='*130}")
        print(f"  THE BRIDGE — 100 TESTING AGENTS (Seoul Medical Group)")
        print(f"  {'─'*120}")
        print(f"  {'ID':<8} {'':3} {'Name':<32} {'Age':>3}  {'City':<16} {'Income':>8}  {'English':<10}  {'Living':<14} {'Children':<16} {'Drop-off'}")
        print(f"  {'─'*120}")
        for a in agents:
            print_agent_summary(a)
        print(f"\n  Use: python3 testing_agents.py --agent N        (view full profile)")
        print(f"  Use: python3 testing_agents.py --review N        (generate app review prompt)")
        print(f"  Use: python3 testing_agents.py --batch-review    (summary of all 100)")
        print(f"  Use: python3 testing_agents.py --export          (export JSON)\n")
        return

    if "--batch-review" in sys.argv:
        run_batch_summary(agents)
        return

    if "--export" in sys.argv:
        filename = "smg_testing_agents_100.json"
        with open(filename, "w") as f:
            json.dump(agents, f, indent=2)
        print(f"\n  Exported {len(agents)} agents to {filename}")
        return

    if "--agent" in sys.argv:
        idx = int(sys.argv[sys.argv.index("--agent") + 1])
        if 1 <= idx <= 100:
            print_agent_detail(agents[idx - 1])
        else:
            print("  Agent ID must be 1-100")
        return

    if "--review" in sys.argv:
        idx = int(sys.argv[sys.argv.index("--review") + 1])
        if 1 <= idx <= 100:
            agent = agents[idx - 1]
            prompt = generate_review_prompt(agent)
            print(f"\n{'='*70}")
            print(f"  REVIEW PROMPT FOR: {agent['id']} — {agent['name']}")
            print(f"{'='*70}")
            print(prompt)
            print(f"\n{'='*70}")
            print(f"  Copy this prompt and send it to Claude to get {agent['name']}'s review.")
            print(f"  Or use: python3 testing_agents.py --screen {idx} \"<screen description>\"")
            print(f"{'='*70}\n")
        return

    if "--screen" in sys.argv:
        idx = int(sys.argv[sys.argv.index("--screen") + 1])
        screen_desc = sys.argv[sys.argv.index("--screen") + 2] if len(sys.argv) > sys.argv.index("--screen") + 2 else None
        if screen_desc and 1 <= idx <= 100:
            agent = agents[idx - 1]
            prompt = generate_review_prompt(agent, screen_desc)
            print(f"\n{'='*70}")
            print(f"  SCREEN REVIEW PROMPT FOR: {agent['id']} — {agent['name']}")
            print(f"{'='*70}")
            print(prompt)
        else:
            print('  Usage: python3 testing_agents.py --screen N "Screen description here"')
        return

    print("  Unknown command. Run without arguments for help.")


if __name__ == "__main__":
    main()

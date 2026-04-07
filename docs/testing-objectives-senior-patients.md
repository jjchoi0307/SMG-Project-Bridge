# Testing Agent Objectives for Claude Code
## What to Feed the 100 Agents and What You're Measuring

---

## OBJECTIVE 1: Usability — Can They Actually Use It?

Run each agent through every screen of The Bridge, one at a time. You're measuring whether this specific person can physically get through each step.

### Tests to Run:

```bash
# Test 1A: First encounter — do they understand what this is?
python3 testing_agents.py --screen 42 "You receive a text message from Seoul Medical Group: 'Download The Bridge app to stay connected with your family about your health care. Your daughter Jenny requested this for you.' There is a link to the App Store."

# Test 1B: App Store page — do they download?
python3 testing_agents.py --screen 42 "You see The Bridge app in the App Store. The description says 'Give your family visibility into your health journey. Track appointments, care gaps, and medications.' The screenshots show a dashboard in English. Download button at bottom."

# Test 1C: Account creation — can they get through the form?
python3 testing_agents.py --screen 42 "Create Your Account screen. Fields: Full Name, Date of Birth, Email Address, Create Password (must be 8+ characters with a number), Phone Number. There is a small toggle in the top right that says 'EN | 한국어'. Submit button at bottom."

# Test 1D: Medical record linking — do they understand this?
python3 testing_agents.py --screen 42 "Connect Your Health Records. 'To show your health information in The Bridge, we need to link your Seoul Medical Group records. Enter your Member ID (found on your insurance card) and date of birth.' Input fields for Member ID and DOB."

# Test 1E: Data sharing consent — the critical gate
python3 testing_agents.py --screen 42 "Share Your Health Data. 'Allow your family members to view: ✓ Upcoming appointments ✓ Care gap alerts ✓ Medication reminders ✓ Referral status.' Buttons: 'Allow Access' / 'Choose What to Share' / 'Maybe Later'"

# Test 1F: Family invitation — can they invite their child?
python3 testing_agents.py --screen 42 "Invite Your Family. 'Enter your family member's email or phone number to invite them to view your health dashboard.' Input field. Button: 'Send Invite'. Link at bottom: 'Skip for now'."
```

### What You're Measuring:
- **Completion rate**: What % of agents make it through each screen?
- **Confusion points**: What specific words, concepts, or UI elements confuse each agent?
- **Abandonment reason**: When they stop, WHY do they stop? Language? Complexity? Privacy? Apathy?
- **Time estimate**: How long would this person realistically spend on each screen?
- **Help needed**: Does this person need someone else to do this for them?

---

## OBJECTIVE 2: Attractiveness — Do They Want This?

Before testing screens, test whether this person even cares. This is where you find out if The Bridge solves a real problem for them or if it's a solution looking for a problem.

### Tests to Run:

```bash
# Test 2A: Value proposition — cold pitch
python3 testing_agents.py --screen 42 "Your doctor says: 'We have a new app called The Bridge. It lets your children see your appointments, your health reminders, and when you have overdue screenings. Would you like to try it?' How do you respond to your doctor?"

# Test 2B: Emotional reaction to being monitored
python3 testing_agents.py --screen 42 "Your daughter tells you: 'Mom, I signed up for this app so I can see when your doctor appointments are and make sure you're going to them. I can also see if you have any overdue health screenings.' How do you feel hearing this? What do you say to her?"

# Test 2C: Competing with current behavior
python3 testing_agents.py --screen 42 "Right now, your daughter calls you every Tuesday and Thursday evening to ask how you're doing and if you went to the doctor. She sometimes calls your doctor's office directly to check on your appointments. Would an app that shows her this information automatically be better or worse than the current phone calls?"

# Test 2D: What would actually make you care?
python3 testing_agents.py --screen 42 "Imagine the PERFECT app for someone in your situation. What would it do for you? What problem would it solve? Don't think about technology — think about your daily life, your health, your family. What do you wish was easier?"
```

### What You're Measuring:
- **Desire**: Does this person actually want their children to see their health data?
- **Resistance**: What specific objections come up? Privacy? Independence? Distrust?
- **Competing behaviors**: What are they doing TODAY instead of using an app? Phone calls? In-person? Nothing?
- **Unmet need**: What do they ACTUALLY need vs. what The Bridge offers?
- **Emotional valence**: Do they feel cared-for or surveilled?

---

## OBJECTIVE 3: Drop-Off Analysis — Where Exactly Do They Leave?

Run the full lifecycle journey for each agent. Track the exact moment they disengage and the reason.

### Tests to Run:

```bash
# Test 3A: Day 1 — first time opening the dashboard
python3 testing_agents.py --screen 42 "You open The Bridge for the first time after your daughter set it up. You see: 'Welcome, Mrs. Kim!' A dashboard shows: Next Appointment: Dr. Ahn, March 24 at 2:00 PM. Care Gaps: 1 overdue (Diabetic Eye Exam). Medications: 4 active reminders. A notification bell in the corner shows '2 new'. What do you do?"

# Test 3B: Day 3 — a notification arrives
python3 testing_agents.py --screen 42 "Your phone buzzes with a notification: 'The Bridge: Reminder — You have an appointment with Dr. Ahn tomorrow at 2:00 PM.' You also got 2 other notifications today from The Bridge about medication reminders. How do you feel about these notifications? Do you open the app?"

# Test 3C: Day 7 — nothing has happened
python3 testing_agents.py --screen 42 "It's been a week since you started using The Bridge. You went to your appointment. You took your medications. Nothing is wrong. The app has been quiet for 3 days — no notifications, no alerts. Do you open it? Do you think about it at all?"

# Test 3D: Day 14 — your daughter mentions it
python3 testing_agents.py --screen 42 "Your daughter calls and says: 'Mom, I saw on The Bridge that you have an overdue eye exam. Can you call Dr. Ahn's office and schedule it?' How do you feel about this? Is this helpful or intrusive?"

# Test 3E: Day 30 — the value test
python3 testing_agents.py --screen 42 "You've had The Bridge for a month. Your daughter checks it regularly. She called you twice about things she saw on the app — once about a missed medication reminder, once about the eye exam. You're not sure how you feel about this. A notification says: 'Rate your experience with The Bridge.' What do you say?"

# Test 3F: Day 60 — quiet period survival
python3 testing_agents.py --screen 42 "It's been two months. You've been healthy. No missed appointments, no care gaps. Your daughter hasn't mentioned the app in 3 weeks. You notice The Bridge is still on your phone. Do you keep it? Delete it? You don't even remember what it does anymore."

# Test 3G: Day 90 — the crisis moment
python3 testing_agents.py --screen 42 "You fell and hurt your wrist. You went to urgent care. The Bridge sent an alert to your daughter: 'New urgent care visit detected for Mrs. Kim.' Your daughter calls within 10 minutes, panicked. Is this a good thing or a bad thing? Does this change how you feel about the app?"
```

### What You're Measuring:
- **Retention curve**: At each time point, is this person still engaged?
- **Quiet period tolerance**: How long without an event before they forget the app exists?
- **Trigger events**: What moments bring them BACK? (Missed appointment, care gap, fall, etc.)
- **Value realization**: At what point does the agent say "okay, this is actually useful"?
- **Notification tolerance**: How many pings before they mute or delete?
- **Relationship impact**: Does the app help or hurt the parent-child dynamic?

---

## OBJECTIVE 4: Children's Experience — How Do They Feel?

The agents file contains patient profiles, but the `--review` prompt can be modified to role-play as the child. Use the family data in each agent to simulate the child's perspective.

### Tests to Run:

```bash
# Test 4A: Child receives the invite
python3 testing_agents.py --screen 42 "You are Jenny Kim, age 42, living in New York. Your mom (Mrs. Kim, age 69, in Koreatown LA) just sent you a text: 'Jenny, I signed up for an app called The Bridge. The doctor helped me. Can you download it? You can see my appointments.' You haven't heard of this app. What do you do?"

# Test 4B: Child sees the dashboard for the first time
python3 testing_agents.py --screen 42 "You are Jenny Kim. You just opened The Bridge. You see your mom's health dashboard: Next appointment March 24. 1 overdue care gap (diabetic eye exam). 4 medications. Last doctor visit: March 3. What is your emotional reaction? What do you click on first?"

# Test 4C: Child sees something concerning
python3 testing_agents.py --screen 42 "You are Jenny Kim. The Bridge shows a new alert: 'Mrs. Kim missed her appointment with Dr. Ahn on March 24.' You call your mom. She says 'Oh, I forgot. I'll reschedule.' But you can also see she has 2 overdue care gaps now. What do you feel? What do you do?"

# Test 4D: Child wants to do something but can't
python3 testing_agents.py --screen 42 "You are Jenny Kim. You see your mom has 3 overdue care gaps. You want to schedule the appointments for her. But The Bridge only shows you the information — there's no button to schedule, no way to message the doctor, no way to do anything except look. How frustrated are you? What do you wish you could do?"

# Test 4E: Child's month-one check-in
python3 testing_agents.py --screen 42 "You are Jenny Kim. You've had The Bridge for a month. You check it every few days. Your mom's data looks stable — she's going to appointments, taking meds. You feel... what? Relieved? Bored? Still anxious? Has The Bridge changed how often you call your mom? Has it changed your relationship at all?"
```

### What You're Measuring:
- **Emotional journey**: Guilt → hope → frustration → relief (or disillusionment)
- **Action gap**: What does the child WANT to do that the app doesn't let them?
- **Notification calibration**: What's the right frequency — daily, weekly, only-on-alerts?
- **Relationship dynamics**: Does visibility help or create new tension?
- **Willingness to pay**: Would this child pay for premium features (scheduling, messaging)?

---

## OBJECTIVE 5: Segment-Level Patterns

After running individual agents, look for patterns ACROSS segments.

### Batch Analysis Commands:

```bash
# Run all 100 agents through the value proposition test
# Compare responses by segment
for i in $(seq 1 100); do
  python3 testing_agents.py --screen $i "Your doctor says: 'We have a new app that lets your children see your health appointments and reminders. Would you like to try it?'" >> results_value_prop.txt
done

# Export all agents and analyze in a spreadsheet
python3 testing_agents.py --export
# Then filter by: dropoff_stage, digital_literacy, isolation_risk, has_distant_child
```

### Patterns to Look For:
- **Which segments say YES immediately?** (Likely: isolated 75+, distant children, high care gaps)
- **Which segments say NO and mean it?** (Likely: independent 60-64, local children, no care gaps)
- **Which segments say YES but will churn?** (Likely: moderate-engagement, quiet health periods)
- **Where is the language barrier lethal vs. annoying?** (Lethal: onboarding. Annoying: daily use if child set up.)
- **Does wealth tier change behavior?** (Low-income: broadband/smartphone barrier. High-income: "I don't need this" barrier.)

---

## PRIORITY ORDER FOR TESTING

1. **Run Objective 1 (Usability) first** on 10 diverse agents — get the onboarding funnel data
2. **Run Objective 3 (Drop-Off) second** on those same 10 — map the full lifecycle
3. **Run Objective 2 (Attractiveness) third** on 20 agents across all segments — find who wants this
4. **Run Objective 4 (Children) fourth** on 10 patient-child pairs — validate the emotional model
5. **Run Objective 5 (Patterns) last** across all 100 — find the segment-level insights

---

## THE 10 AGENTS TO START WITH

Pick these 10 for your first round — they cover the full spectrum:

| Agent | Why This One |
|---|---|
| TA-001 to TA-005 | First 5 generated — random spread |
| TA-015 | Likely a Korean 70s, low digital lit — hardest onboarding case |
| TA-030 | Mid-range — tests the "average" patient |
| TA-055 | Likely non-Korean — tests cultural fit |
| TA-075 | Likely 80+ — tests dependent patient model |
| TA-100 | Last generated — checks edge cases |

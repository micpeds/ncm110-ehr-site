/* =====================================================================
   CareChart EHR — shared server logic ("core")
   ---------------------------------------------------------------------
   The SAME file runs in two places:
     • in the browser (demo mode, data in localStorage)
     • in Google Apps Script (copy it into the script project as Core.gs)
   Storage is passed in as a "store" object, so the rules live in one
   place. Contains NO secrets: passwords are salted hashes and answer
   keys are data inside each case.
   ===================================================================== */
var EHRCore = (function () {

  /* ---------------- tiny synchronous SHA-256 ---------------- */
  function sha256(ascii) {
    function rr(v, n) { return (v >>> n) | (v << (32 - n)); }
    var str = unescape(encodeURIComponent(String(ascii)));
    var maxWord = Math.pow(2, 32), result = '', words = [], bitLen = str.length * 8;
    var hash = [], k = [], primeCounter = 0, isComposite = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
        hash[primeCounter] = (Math.pow(candidate, .5) * maxWord) | 0;
        k[primeCounter++] = (Math.pow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    str += '\x80';
    while (str.length % 64 - 56) str += '\x00';
    for (i = 0; i < str.length; i++) {
      var j = str.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((bitLen / maxWord) | 0);
    words[words.length] = (bitLen);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
    return result;
  }

  /* ---------------- built-in sample case (no answer key here) ---------------- */
  var SAMPLE_ID = 'sample-lola';
  var PRACTICE_MIN = 60;   // % of the practice chart a group must complete before it can finish practice
  var SAMPLE_CASE = {
    id: SAMPLE_ID, builtin: true, owner: '',
    title: 'Lola Charing – Community-acquired pneumonia',
    patient: {
      name: 'VILLANUEVA, Rosario M.', nickname: 'Lola Charing', hospNo: '2026-004517', dob: '14 March 1954', age: '72 y', sex: 'Female',
      ward: 'Medical Ward 3', bed: '12', attending: 'Dr. A. Ramos', dx: 'Community-acquired pneumonia, right lower lobe',
      allergy: 'Sulfonamide (cotrimoxazole) – rash', weight: '52 kg', height: '152 cm', admission: 'Day 1, 0730 H, from the ED',
      code: 'Full Code', isolation: 'Droplet', fallRisk: 'High', ews: '6',
      context: 'Lives in Quezon City with daughter Mila; retired public school teacher; walks with a cane; 4 days of cough and fever.'
    },
    census: [
      { bed: '08', name: 'DELA CRUZ, Ernesto P.', age: '68 y M', md: 'Dr. L. Santos', dx: 'Heart failure, acute exacerbation', allergy: 'NKDA', fall: 'Mod', iso: '', ews: '3' },
      { bed: '09', name: 'MENDOZA, Liza R.', age: '45 y F', md: 'Dr. A. Ramos', dx: 'Dengue fever without warning signs', allergy: 'NKDA', fall: 'Low', iso: 'Standard', ews: '1' },
      { bed: '10', name: 'GARCIA, Pedro S.', age: '81 y M', md: 'Dr. M. Tan', dx: 'COPD in acute exacerbation', allergy: 'Penicillin', fall: 'High', iso: 'Droplet', ews: '5' },
      { bed: '14', name: 'AQUINO, Josefina T.', age: '59 y F', md: 'Dr. M. Tan', dx: 'Type 2 diabetes mellitus, uncontrolled', allergy: 'NKDA', fall: 'Low', iso: '', ews: '0' },
      { bed: '15', name: 'REYES, Mark A.', age: '34 y M', md: 'Dr. L. Santos', dx: 'Acute gastroenteritis', allergy: 'Shellfish', fall: 'Low', iso: 'Contact', ews: '2' },
      { bed: '16', name: 'BAUTISTA, Carmen L.', age: '77 y F', md: 'Dr. A. Ramos', dx: 'Ischemic stroke, day 3', allergy: 'NKDA', fall: 'High', iso: '', ews: '2' }
    ],
    orders: [
      { cat: 'Respiratory', text: 'Oxygen via nasal cannula at 2–4 L/min; titrate to keep SpO2 at 92% or higher.', status: 'Active' },
      { cat: 'Medication', text: 'Ceftriaxone 2 g IV once daily (first dose 0900 H).', status: 'Active' },
      { cat: 'Medication', text: 'Azithromycin 500 mg PO once daily.', status: 'Active' },
      { cat: 'Medication', text: 'Paracetamol 500 mg PO every 4 hours as needed for temperature 38.0 °C or higher, or for pain.', status: 'Active PRN' },
      { cat: 'IV Fluids', text: 'PNSS 1 L at 80 mL/hour.', status: 'Active' },
      { cat: 'Lab / Imaging', text: 'CBC, sputum Gram stain and culture, chest X-ray (done in ED).', status: 'Completed' },
      { cat: 'Nursing', text: 'Vital signs every 4 hours; SpO2 monitoring.', status: 'Active' },
      { cat: 'Diet', text: 'Soft diet as tolerated; strict intake and output.', status: 'Active' },
      { cat: 'Safety', text: 'Fall precautions.', status: 'Active' }
    ],
    cards: [
      '"Hirap akong huminga, lalo na kapag naglalakad papuntang CR." (It is hard to breathe, especially when I walk to the bathroom.)',
      '0800 H: Temperature 38.6 °C (axillary)', '0800 H: Heart rate 108 beats/min, regular',
      '0800 H: Respiratory rate 26 breaths/min; uses neck accessory muscles', '0800 H: BP 130/80 mmHg, right arm, sitting',
      '0800 H: SpO2 90% on room air', 'Crackles over the right lower posterior chest; left lung clear',
      'Productive cough with thick, yellow sputum, about 1 tablespoon per episode',
      '"Masakit ang kanang dibdib ko kapag umuubo." Pain 6/10, sharp, right lower chest, worse with coughing',
      'Splints right side with her arm when coughing; grimaces', 'Chest X-ray: right lower lobe consolidation',
      'CBC: WBC 15.8 x 10^9/L (high); neutrophils 85%',
      'Daughter: "Nadulas po si Mama sa banyo noong isang buwan." (Mama slipped in the bathroom last month.)',
      'Wakes up 2–3 times at night to urinate', 'Walks with a cane; unsteady when standing up',
      'Morse Fall Scale score: 55 (high risk; 45 or higher)', '"Wala akong ganang kumain." Ate about one-quarter of meals for 3 days',
      'Dry lips and oral mucosa; urine output 250 mL from 0730–1530 H',
      '"Natatakot ako, baka ma-ICU ako tulad ng asawa ko." (I\'m afraid I\'ll end up in the ICU like my husband.)',
      'Had an appendectomy in 1980', 'Her favorite teleserye airs at 2000 H', 'Allergy: cotrimoxazole caused a rash in 2019',
      'Braden Scale score: 18', '0815 H: Oxygen started via nasal cannula at 3 L/min; head of bed raised to 45 degrees',
      '0830 H: Taught pursed-lip breathing and pillow splinting during cough; client did a return demonstration',
      '0845 H: Paracetamol 500 mg PO given for T 38.6 °C and pain 6/10',
      '0900 H: Ceftriaxone 2 g IV given via left forearm IV line (patent, no swelling)',
      '0900 H: Bed in low position, bed alarm on, call bell within reach; daughter oriented to fall precautions',
      '0945 H: T 37.8 °C; pain 3/10; SpO2 93% on 3 L/min',
      '1200 H: SpO2 94% on 3 L/min; RR 22; still dyspneic when walking to the bathroom with assistance',
      '1200 H: Ate half of the soft-diet lunch; oral fluid intake 600 mL since 0730 H',
      '1300 H: Called for help before getting up to urinate; no falls this shift',
      '1400 H: Explained the treatment plan; client said, "Mas panatag na ako ngayon." (I feel calmer now.)'
    ],
    flowTime: '0800 H',
    flowsheetRows: ['Temperature', 'Heart rate', 'Respiratory rate', 'Blood pressure', 'SpO2', 'Oxygen device and flow', 'Pain score',
      'Pain location / quality', 'Lung sounds', 'Cough / sputum', 'Morse Fall Scale', 'Braden Scale', 'Allergy verified with client',
      'Oral intake (past 3 days)', 'Mucous membranes'],
    labs: [
      { panel: 'Complete Blood Count', collected: 'Day 1, 0650 H (ED)', status: 'Final', test: 'WBC', value: '15.8', unit: 'x 10^9/L', ref: '4.5 – 11.0', flag: 'H' },
      { panel: 'Complete Blood Count', collected: 'Day 1, 0650 H (ED)', status: 'Final', test: 'Neutrophils', value: '85', unit: '%', ref: '50 – 70', flag: 'H' },
      { panel: 'Sputum Gram stain and culture', collected: 'Day 1, 0715 H (ED)', status: 'Pending', test: 'Gram stain', value: 'Pending', unit: '', ref: '', flag: '' },
      { panel: 'Sputum Gram stain and culture', collected: 'Day 1, 0715 H (ED)', status: 'Pending', test: 'Culture and sensitivity', value: 'Pending', unit: '', ref: '', flag: '' }
    ],
    imaging: [{ study: 'Chest X-ray, PA view', done: 'Day 1, 0700 H (ED)', status: 'Final', findings: 'Right lower lobe consolidation.', impression: 'Findings consistent with right lower lobe pneumonia. Clinical correlation advised.' }],
    mar: [
      { med: 'Ceftriaxone', dose: '2 g', route: 'IV', freq: 'Once daily (first dose 0900 H)', kind: 'Scheduled', every: '24', first: '0900', due: '', order: '2' },
      { med: 'Azithromycin', dose: '500 mg', route: 'PO', freq: 'Once daily', kind: 'Scheduled', every: '24', first: '0900', due: '', order: '3' },
      { med: 'Paracetamol', dose: '500 mg', route: 'PO', freq: 'Every 4 hours PRN – T ≥ 38.0 °C or pain', kind: 'PRN', due: '', order: '4' },
      { med: 'PNSS (0.9% NaCl)', dose: '1 L', route: 'IV', freq: 'Continuous at 80 mL/hour', kind: 'Continuous', due: '', order: '5' }
    ],
    vitals: [
      { time: '0800', temp: '38.6', hr: '108', rr: '26', sbp: '130', dbp: '80', spo2: '90', o2: 'room air', pain: '6' },
      { time: '0945', temp: '37.8', hr: '', rr: '', sbp: '', dbp: '', spo2: '93', o2: '3 L/min NC', pain: '3' },
      { time: '1200', temp: '', hr: '', rr: '22', sbp: '', dbp: '', spo2: '94', o2: '3 L/min NC', pain: '' }
    ],
    alerts: {
      allergyKeywords: 'cotrimoxazole, sulfamethoxazole, bactrim, sulfa',
      allergyAdvice: 'Avoid sulfonamide-containing drugs (e.g., cotrimoxazole). Verify the allergy with the client and daughter.',
      spo2Min: '92', spo2Text: 'Order 1: Oxygen via nasal cannula at 2–4 L/min; titrate to keep SpO2 ≥ 92%.',
      feverMin: '38', feverText: 'Order 4: Paracetamol 500 mg PO every 4 hours as needed. Remember to reassess after giving a PRN drug.',
      fallText: 'Morse Fall Scale 55 (high risk ≥ 45). Active order: Fall precautions. Consider bed in low position, bed alarm, call bell within reach, non-slip footwear, assisted toileting.'
    },
    auditNurse: 'J. Reyes, RN',
    auditRecord: [
      { section: 'Banner', entry: 'VILLANUEVA, Rosario M. | Hospital No. 2026-004517 | DOB 14 March 1945 | Allergy: NKDA' },
      { section: 'Flowsheet 0800', entry: 'T 38.6 | HR 108 | RR 16 | BP 130/80 | SpO2 98% RA | Pain 6/10 | JR | entered 0805' },
      { section: 'Flowsheet 1200', entry: 'T 37.4 | HR 96 | RR 22 | BP 120/80 | SpO2 94% | Pain — | JR | entered 1210' },
      { section: 'Fall risk', entry: 'Morse 55 – Low risk. Fall precautions: (blank)' },
      { section: 'eMAR', entry: 'Ceftriaxone 2 g IV QD – charted given 0900 – JR' },
      { section: 'eMAR', entry: 'Azithromycin 500 mg PO QD – (blank)' },
      { section: 'eMAR', entry: 'Paracetamol 500.0 mg PO q4h PRN – charted given 0845 – JR' },
      { section: 'Note 0805 H', entry: 'Received client awake, on room air. Lungs clear on both sides. No respiratory distress. Pain on chest 6/10. – JR' },
      { section: 'Note 0830 H', entry: 'IV line on left forearm infiltrated; removed. IV access to be re-inserted by IV team. – JR' },
      { section: 'Note 1130 H (event time 1500 H)', entry: 'Client ambulated to CR with assistance, tolerated well, no dyspnea. – JR' },
      { section: 'Note 1300 H', entry: 'Paracetamol given at 0845 for fever. Client is demanding and uncooperative, keeps asking if she will go to the ICU. – (no signature)' },
      { section: 'Note 1400 H', entry: 'Evaluation: Impaired gas exchange – Goal met. – JR' },
      { section: 'Care plan', entry: 'Pneumonia related to infection as evidenced by fever and cough.' }
    ],
    exitQuestions: [
      'Which error in Task 5 was the most dangerous for the client? Why?',
      'Give one example of how an EHR convenience feature (templates, copy-forward, defaults) can harm data quality.',
      'The 0800 SpO2 was charted as 98% instead of 90%. Which downstream decisions would that change?',
      'Complete: "Starting today, before I click Sign, I will always check..."'
    ],
    key: { audit: [], notes: [] }
  };

  /* ---------------- built-in case 2: type 2 diabetes with infected foot ulcer (no answer key here) ---------------- */
  var SAMPLE_DM_ID = 'sample-dm';
  var SAMPLE_DM = {
    id: SAMPLE_DM_ID, builtin: true, owner: '',
    title: 'Mang Erning – Type 2 diabetes with infected foot ulcer',
    patient: {
      name: 'SANTOS, Ernesto D.', nickname: 'Mang Erning', hospNo: '2026-005132', dob: '2 July 1967', age: '59 y', sex: 'Male',
      ward: 'Medical Ward 2', bed: '5', attending: 'Dr. P. Castillo', dx: 'Type 2 diabetes mellitus, uncontrolled, with infected right diabetic foot ulcer',
      allergy: 'Seafood (shrimp) – hives', weight: '78 kg', height: '165 cm', admission: 'Day 1, 0645 H, from the ED',
      code: 'Full Code', isolation: 'Contact', fallRisk: 'High', ews: '4',
      context: 'Lives in Pasig with his wife Linda and two teenage children; tricycle driver and main earner; often skips medicines when money runs short; 5 days of right foot swelling.'
    },
    census: [
      { bed: '01', name: 'RAMOS, Teresita G.', age: '66 y F', md: 'Dr. P. Castillo', dx: 'Community-acquired pneumonia', allergy: 'NKDA', fall: 'Mod', iso: 'Droplet', ews: '4' },
      { bed: '02', name: 'LOPEZ, Danilo M.', age: '49 y M', md: 'Dr. A. Ramos', dx: 'Acute pancreatitis', allergy: 'NKDA', fall: 'Low', iso: '', ews: '3' },
      { bed: '03', name: 'FERRER, Grace A.', age: '35 y F', md: 'Dr. M. Tan', dx: 'Dengue fever with warning signs', allergy: 'Penicillin', fall: 'Low', iso: 'Standard', ews: '2' },
      { bed: '04', name: 'NAVARRO, Pedro L.', age: '72 y M', md: 'Dr. L. Santos', dx: 'Chronic kidney disease, stage 4', allergy: 'NKDA', fall: 'High', iso: '', ews: '3' },
      { bed: '06', name: 'CRUZ, Melinda R.', age: '58 y F', md: 'Dr. P. Castillo', dx: 'Hypertensive urgency', allergy: 'NKDA', fall: 'Low', iso: '', ews: '1' },
      { bed: '07', name: 'TORRES, Alvin J.', age: '28 y M', md: 'Dr. A. Ramos', dx: 'Acute appendicitis, post-op day 1', allergy: 'Aspirin', fall: 'Low', iso: '', ews: '1' }
    ],
    orders: [
      { cat: 'Monitoring', text: 'Capillary blood glucose (CBG) before meals and at bedtime (0700, 1100, 1700, 2100 H).', status: 'Active' },
      { cat: 'Medication', text: 'Insulin regular (human) subcutaneous per sliding scale before meals and at bedtime: CBG 151–200 mg/dL = 2 units; 201–250 = 4 units; 251–300 = 6 units; 301–350 = 8 units; above 350 = 10 units and notify physician. CBG below 70 mg/dL: hold insulin, give 15 g fast-acting carbohydrate, recheck in 15 minutes.', status: 'Active' },
      { cat: 'Medication', text: 'Insulin glargine 20 units subcutaneous once daily at bedtime (2100 H).', status: 'Active' },
      { cat: 'Medication', text: 'Metformin 500 mg PO twice daily with breakfast and dinner (0700 H, 1700 H).', status: 'Active' },
      { cat: 'Medication', text: 'Ampicillin–sulbactam 1.5 g IV every 6 hours (first dose 1200 H).', status: 'Active' },
      { cat: 'Medication', text: 'Paracetamol 500 mg PO every 4 hours as needed for temperature 38.0 °C or higher, or for pain.', status: 'Active PRN' },
      { cat: 'IV Fluids', text: 'PNSS 1 L at 100 mL/hour.', status: 'Active' },
      { cat: 'Diet', text: 'Diabetic diet 1,800 kcal/day; strict intake and output.', status: 'Active' },
      { cat: 'Wound care', text: 'Right foot wound: clean with PNSS and apply dry sterile dressing once daily and as needed; elevate right foot.', status: 'Active' },
      { cat: 'Nursing', text: 'Vital signs every 4 hours; neurovascular check of right foot every 4 hours.', status: 'Active' },
      { cat: 'Lab / Imaging', text: 'CBC, HbA1c, serum creatinine and electrolytes, wound culture and sensitivity, X-ray of right foot (done).', status: 'Completed' },
      { cat: 'Safety', text: 'Fall precautions.', status: 'Active' }
    ],
    cards: [
      '"Ilang araw na pong namamaga at masakit ang paa ko. Hindi ko napansin agad kasi manhid." (My foot has been swollen and painful for days. I didn\'t notice right away because it is numb.)',
      '0700 H: CBG 312 mg/dL (fingerstick, before breakfast)',
      '0800 H: Temperature 38.2 °C (axillary)',
      '0800 H: Heart rate 102 beats/min, regular',
      '0800 H: Respiratory rate 20 breaths/min',
      '0800 H: BP 148/90 mmHg, left arm, sitting',
      '0800 H: SpO2 97% on room air',
      'Right plantar foot: open wound 3 cm x 2 cm with yellow drainage and foul odor; surrounding skin red and warm to touch',
      '"Masakit ang paa ko, mga 5 sa 10, lalo na kapag tinatapakan." Pain 5/10, throbbing, right foot, worse when bearing weight',
      'Reduced sensation to monofilament on both feet; right pedal pulse palpable but weak',
      '"Lagi po akong nauuhaw at madalas umihi, kahit gabi." (I\'m always thirsty and urinate often, even at night.)',
      'Dry lips and oral mucosa; skin turgor slightly decreased',
      'HbA1c 9.8% (high)',
      'CBC: WBC 13.2 x 10^9/L (high); neutrophils 80%',
      'X-ray right foot: soft-tissue swelling; no bone involvement seen',
      'Wife: "Hindi po siya umiinom ng gamot kapag wala nang pera. Mahilig din po sa kanin at softdrinks." (He doesn\'t take his medicine when money runs out. He also loves rice and soft drinks.)',
      '"Hindi ko alam na kailangan palang tingnan araw-araw ang paa." (I didn\'t know I had to check my feet every day.)',
      'Walks barefoot at home; wears slippers outside',
      'Morse Fall Scale score: 45 (high risk; 45 or higher)',
      'Braden Scale score: 19',
      'Weight 78 kg, height 165 cm (BMI 28.7)',
      'Type 2 diabetes for 10 years; hypertension for 5 years',
      'Works as a tricycle driver; the family\'s main earner',
      'His favorite basketball team plays tonight',
      '0700 H: Insulin regular 8 units subcutaneous given per sliding scale for CBG 312 mg/dL (left abdomen)',
      '0730 H: Ate all of the diabetic breakfast tray; drank 240 mL water',
      '0900 H: Wound culture specimen taken, then right foot wound cleaned with PNSS and covered with dry sterile dressing; foot elevated on a pillow',
      '0930 H: Taught daily foot inspection using a mirror; client did a return demonstration',
      '1100 H: CBG 238 mg/dL; insulin regular 4 units subcutaneous given (right abdomen)',
      '1200 H: Ampicillin–sulbactam 1.5 g IV given via right forearm IV line (patent, no swelling)',
      '1200 H: T 37.6 °C; HR 94; BP 140/86; pain 3/10 with right foot elevated',
      '1400 H: Wife taught signs of low blood sugar; she listed shakiness, sweating and confusion',
      '1600 H: Oral fluid intake 1,200 mL since 0700 H; urine output 1,400 mL'
    ],
    flowTime: '0800 H',
    flowsheetRows: ['Temperature', 'Heart rate', 'Respiratory rate', 'Blood pressure', 'SpO2', 'CBG (0700 H)', 'Pain score', 'Pain location / quality',
      'Wound appearance', 'Pedal pulses / foot sensation', 'Mucous membranes / skin turgor', 'Morse Fall Scale', 'Braden Scale', 'Allergy verified with client', 'Weight / BMI'],
    labs: [
      { panel: 'Point-of-care glucose', collected: 'Day 1, 0700 H', status: 'Final', test: 'Capillary blood glucose', value: '312', unit: 'mg/dL', ref: '70 – 140', flag: 'H' },
      { panel: 'Point-of-care glucose', collected: 'Day 1, 1100 H', status: 'Final', test: 'Capillary blood glucose', value: '238', unit: 'mg/dL', ref: '70 – 140', flag: 'H' },
      { panel: 'Chemistry', collected: 'Day 1, 0650 H (ED)', status: 'Final', test: 'HbA1c', value: '9.8', unit: '%', ref: '4.0 – 5.6', flag: 'H' },
      { panel: 'Chemistry', collected: 'Day 1, 0650 H (ED)', status: 'Final', test: 'Creatinine', value: '1.0', unit: 'mg/dL', ref: '0.6 – 1.2', flag: '' },
      { panel: 'Chemistry', collected: 'Day 1, 0650 H (ED)', status: 'Final', test: 'Sodium', value: '136', unit: 'mmol/L', ref: '135 – 145', flag: '' },
      { panel: 'Chemistry', collected: 'Day 1, 0650 H (ED)', status: 'Final', test: 'Potassium', value: '4.1', unit: 'mmol/L', ref: '3.5 – 5.0', flag: '' },
      { panel: 'Complete Blood Count', collected: 'Day 1, 0650 H (ED)', status: 'Final', test: 'WBC', value: '13.2', unit: 'x 10^9/L', ref: '4.5 – 11.0', flag: 'H' },
      { panel: 'Complete Blood Count', collected: 'Day 1, 0650 H (ED)', status: 'Final', test: 'Neutrophils', value: '80', unit: '%', ref: '50 – 70', flag: 'H' },
      { panel: 'Wound culture and sensitivity', collected: 'Day 1, 0900 H', status: 'Pending', test: 'Culture and sensitivity', value: 'Pending', unit: '', ref: '', flag: '' }
    ],
    imaging: [{ study: 'X-ray right foot, 2 views', done: 'Day 1, 0720 H (ED)', status: 'Final', findings: 'Soft-tissue swelling over the plantar aspect of the right forefoot. No cortical erosion or soft-tissue gas.', impression: 'Soft-tissue swelling; no radiographic evidence of osteomyelitis. Clinical correlation advised.' }],
    mar: [
      { med: 'Insulin regular (human)', dose: 'per sliding scale', route: 'SC', freq: 'Before meals and at bedtime (AC & HS)', kind: 'Scheduled', every: '', first: '', due: '0700, 1100, 1700, 2100', order: '2' },
      { med: 'Insulin glargine', dose: '20 units', route: 'SC', freq: 'Once daily at bedtime', kind: 'Scheduled', every: '24', first: '2100', due: '', order: '3' },
      { med: 'Metformin', dose: '500 mg', route: 'PO', freq: 'Twice daily with breakfast and dinner', kind: 'Scheduled', every: '', first: '', due: '0700, 1700', order: '4' },
      { med: 'Ampicillin–sulbactam', dose: '1.5 g', route: 'IV', freq: 'Every 6 hours (first dose 1200 H)', kind: 'Scheduled', every: '6', first: '1200', due: '', order: '5' },
      { med: 'Paracetamol', dose: '500 mg', route: 'PO', freq: 'Every 4 hours PRN – T ≥ 38.0 °C or pain', kind: 'PRN', every: '', first: '', due: '', order: '6' },
      { med: 'PNSS (0.9% NaCl)', dose: '1 L', route: 'IV', freq: 'Continuous at 100 mL/hour', kind: 'Continuous', every: '', first: '', due: '', order: '7' }
    ],
    vitals: [
      { time: '0800', temp: '38.2', hr: '102', rr: '20', sbp: '148', dbp: '90', spo2: '97', o2: 'room air', pain: '5' },
      { time: '1200', temp: '37.6', hr: '94', rr: '', sbp: '140', dbp: '86', spo2: '', o2: '', pain: '3' }
    ],
    ranges: {},
    alerts: {
      allergyKeywords: 'shrimp, shellfish, seafood, prawn',
      allergyAdvice: 'Food allergy: seafood (shrimp) causes hives. Make sure dietary services and the meal tray reflect it.',
      spo2Min: '92', spo2Text: 'No oxygen order is active. Recheck, assess breathing, and notify the physician.',
      feverMin: '38', feverText: 'Order 6: Paracetamol 500 mg PO every 4 hours as needed. Reassess after giving a PRN drug. Fever may signal worsening wound infection.',
      fallText: 'Morse Fall Scale 45 (high risk ≥ 45) with reduced sensation in both feet. Active order: Fall precautions. Keep bed low, call bell within reach, non-slip footwear (not barefoot), assist when walking.'
    },
    auditNurse: 'M. Lim, RN',
    auditRecord: [
      { section: 'Banner', entry: 'SANTOS, Ernesto D. | Hospital No. 2026-005132 | DOB 2 July 1968 | Allergy: NKDA' },
      { section: 'CBG 0700 H', entry: 'CBG 132 mg/dL – no insulin needed per sliding scale. – ML' },
      { section: 'eMAR 0700 H', entry: 'Insulin regular 8 U SC – charted given 0700 – ML' },
      { section: 'eMAR', entry: 'Insulin glargine 20 units SC – charted given 0900 – ML' },
      { section: 'eMAR', entry: 'Ampicillin–sulbactam 1.5 g IV QD – (blank)' },
      { section: 'eMAR', entry: 'Metformin 500.0 mg PO BID – charted given 0700 – ML' },
      { section: 'Flowsheet 0800', entry: 'T 37.2 | HR 102 | RR 20 | BP 148/90 | SpO2 97% RA | Pain 0/10 | ML | entered 0805' },
      { section: 'Fall risk', entry: 'Morse 45 – Low risk. Fall precautions: (blank)' },
      { section: 'Wound note 0900 H', entry: 'Right foot wound clean and dry, no drainage, no odor. Dressing changed. – ML' },
      { section: 'Note 0930 H', entry: 'Client is noncompliant and lazy about his medicines and diet. – ML' },
      { section: 'Note 1100 H (event time 1700 H)', entry: 'Dinner insulin given per sliding scale; client tolerated well. – ML' },
      { section: 'Note 1400 H', entry: 'Evaluation: Risk for unstable blood glucose – Goal met. – (no signature)' },
      { section: 'Care plan', entry: 'Diabetes mellitus related to high sugar as evidenced by CBG 312.' }
    ],
    exitQuestions: [
      'Which error in Task 5 was the most dangerous for the client? Why?',
      'The 0700 CBG was charted as 132 mg/dL instead of 312. Which decisions would that change?',
      'How can EHR order sets, sliding-scale tools or alerts prevent insulin errors, and how can they cause them?',
      'Complete: "Starting today, before I click Sign, I will always check..."'
    ],
    key: { audit: [], notes: [] }
  };
  var BUILTINS = {}; BUILTINS[SAMPLE_ID] = SAMPLE_CASE; BUILTINS[SAMPLE_DM_ID] = SAMPLE_DM;

  /* A blank case for "start from scratch" */
  function blankCase() {
    return {
      title: 'Untitled case',
      patient: { name: 'LASTNAME, Firstname M.', nickname: '', hospNo: '2026-000000', dob: '1 January 1960', age: '66 y', sex: 'Female', ward: 'Medical Ward 3', bed: '12', attending: 'Dr. ', dx: '', allergy: 'NKDA', weight: '', height: '', admission: 'Day 1, 0730 H', code: 'Full Code', isolation: '', fallRisk: 'Low', ews: '0', context: '' },
      census: clone(SAMPLE_CASE.census), orders: [], cards: [], vitals: [], flowTime: '0800 H', flowsheetRows: clone(SAMPLE_CASE.flowsheetRows),
      labs: [], imaging: [], mar: [],
      alerts: { allergyKeywords: '', allergyAdvice: '', spo2Min: '92', spo2Text: '', feverMin: '38', feverText: '', fallText: '' },
      auditNurse: 'J. Reyes, RN', auditRecord: [], exitQuestions: clone(SAMPLE_CASE.exitQuestions), key: { audit: [], notes: [] }
    };
  }

  /* ---------------- helpers ---------------- */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clean(s, n) { return String(s == null ? '' : s).trim().replace(/\s+/g, '').slice(0, n || 50); }
  function err(msg) { throw new Error(msg); }
  function secId(s) { return clean(s, 20).toUpperCase(); }
  function recId(section, group) { return secId(section) + '-G' + String(+group); }
  function pinHash(id, pin) { return sha256(id + ':' + pin); }
  function pwHash(user, pw) { return sha256('ehr-staff:' + user + ':' + pw); }
  function stripKey(c) { var o = clone(c); delete o.key; return o; }

  function getCase(store, id, keyStore) {
    if (!id) return null;
    if (BUILTINS[id]) {
      var s = clone(BUILTINS[id]); var ks = keyStore || {};
      var k = (ks.keys && ks.keys[id]) || (id === SAMPLE_ID ? ks.sampleKey : null);
      if (k) s.key = k;
      return s;
    }
    return store.get('cases', id);
  }

  function recPublic(r, withData) {
    var o = { id: r.id, section: r.section, group: r.group, status: r.status, caseId: r.caseId || '', updatedAt: r.updatedAt, submittedAt: r.submittedAt || null,
      released: !!r.released, total: r.grades && r.grades.total != null && r.grades.total !== '' ? r.grades.total : null, progress: r.progress || 0, members: r.members || [], gradedBy: r.grades ? r.grades.by || '' : '',
      version: +r.version || 0, taskProgress: r.taskProgress || null, scores: r.grades && r.grades.scores ? r.grades.scores : null,
      practiceDone: practiceDone(r), practiceDoneAt: r.practiceDoneAt || null, practiceBy: r.practiceBy || '', practiceWaivedBy: r.practiceWaivedBy || '' };
    if (withData) { o.data = r.data || null; o.grades = r.grades || null; }
    return o;
  }
  // Lola Charing is ALWAYS the practice case, and a group must finish it before the graded task.
  // Charts that already had graded work before this rule existed are treated as done.
  function practiceDone(r) { return !!(r.practiceDoneAt || r.data); }
  function membersOf(d) { try { return d.group.members.filter(function (m) { return m.name && m.name.trim(); }).map(function (m) { return m.name.trim(); }); } catch (e) { return []; } }

  /* ---------------- staff sessions ---------------- */
  function staff(store, req, adminOnly) {
    var s = req.token && store.sessionGet(req.token);
    if (!s) err('Your session has expired. Please sign in again.');
    var u = store.get('instructors', s.username);
    if (!u || u.active === false) err('Account disabled.');
    if (adminOnly && u.role !== 'admin') err('Admins only.');
    return u;
  }
  // A section (its groups, cases, Task 5 switch and charts) belongs to its instructor only.
  // Admins create sections and assign instructors, but do not run other instructors' sections.
  function canSection(u, sec) { return !!(sec && sec.instructor === u.id); }
  function mySections(store, u) { return store.list('sections').filter(function (s) { return canSection(u, s); }); }
  function userPublic(u) { return { id: u.id, name: u.name, role: u.role, active: u.active !== false }; }

  /* ---------------- actions ---------------- */
  var A = {};

  /* ----- public / students ----- */
  A.getSections = function (store) {
    return store.list('sections').filter(function (s) { return s.caseId && +s.groups > 0; })
      .map(function (s) { return { code: s.id, groups: +s.groups || 0 }; })
      .sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  };
  A.getConfig = function (store, r) {
    var s = store.get('sections', secId(r.section));
    return s ? { task5Unlocked: !!s.task5Unlocked, acceptingSubmissions: s.acceptingSubmissions !== false } : { task5Unlocked: false, acceptingSubmissions: true };
  };
  A.login = function (store, r, ks) {
    var sec = store.get('sections', secId(r.section));
    if (!sec) err('Section not found. Choose your section from the list.');
    if (!sec.caseId) err('Your instructor has not assigned a patient to this section yet.');
    if (!(+sec.groups > 0)) err('Your instructor has not set the number of groups for this section yet.');
    if (!/^\d{1,3}$/.test(clean(r.group, 3)) || +r.group < 1 || +r.group > (+sec.groups || 0)) err('Group must be between 1 and ' + sec.groups + ' for ' + sec.id + '.');
    var pin = String(r.pin || '');
    if (!/^\d{4,6}$/.test(pin)) err('PIN must be 4–6 digits.');
    var id = recId(sec.id, r.group);
    return store.withLock(function () {
      var rec = store.get('records', id);
      if (!rec) {
        if (!r.create) return { notFound: true, id: id };
        var now = store.now();
        rec = { id: id, section: sec.id, group: String(+r.group), pinHash: pinHash(id, pin), status: 'draft', caseId: sec.caseId, createdAt: now, updatedAt: now, data: null, progress: 0, members: [] };
        store.put('records', rec);
      } else if (rec.pinHash !== pinHash(id, pin)) err('Wrong group PIN for ' + id + '.');
      var c = getCase(store, rec.caseId || sec.caseId, ks);
      if (!c) err('The patient case for this section is missing. Tell your instructor.');
      var out = recPublic(rec, true);
      if (!rec.released) out.grades = null;
      var pc = (rec.caseId || sec.caseId) !== SAMPLE_ID ? getCase(store, SAMPLE_ID) : null;
      return { created: !rec.data && rec.createdAt === rec.updatedAt, record: out, case: stripKey(c), practiceCase: pc ? stripKey(pc) : null, practiceDone: !pc || practiceDone(rec) };
    });
  };
  function auth(store, r) {
    var id = recId(r.section, r.group);
    var rec = store.get('records', id);
    if (!rec || rec.pinHash !== pinHash(id, String(r.pin || ''))) err('Session expired. Please log in again.');
    return rec;
  }
  A.save = function (store, r) {
    return store.withLock(function () {
      var rec = auth(store, r);
      if (rec.status !== 'draft') err('This record is already signed and submitted.');
      rec.data = r.data; rec.progress = +r.progress || 0; rec.members = membersOf(r.data); rec.updatedAt = store.now();
      rec.version = (+rec.version || 0) + 1;
      store.put('records', rec);
      store.cachePut('ver_' + rec.id, String(rec.version));
      return { updatedAt: rec.updatedAt, version: rec.version };
    });
  };
  A.submit = function (store, r) {
    return store.withLock(function () {
      var rec = auth(store, r);
      var sec = store.get('sections', rec.section);
      if (sec && sec.acceptingSubmissions === false) err('Submissions are closed for this section.');
      if (rec.status !== 'draft') err('This record is already signed and submitted.');
      rec.data = r.data; rec.progress = +r.progress || 0; rec.members = membersOf(r.data);
      rec.status = 'submitted'; rec.submittedAt = rec.updatedAt = store.now();
      if (r.taskProgress) rec.taskProgress = r.taskProgress;
      rec.version = (+rec.version || 0) + 1;
      store.put('records', rec);
      store.cachePut('ver_' + rec.id, String(rec.version));
      return { submittedAt: rec.submittedAt, version: rec.version };
    });
  };

  /* ----- live group sync -----
     Every device of a group calls this every few seconds. It sends only the
     fields that device changed ("patches": path → value) plus new audit-trail
     lines, and gets back the merged chart whenever anyone else changed it.
     Two members typing in different boxes therefore never overwrite each other. */
  function setPathIn(o, path, v) {
    var ks = String(path).split('.'), a = o;
    for (var i = 0; i < ks.length - 1; i++) {
      if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
      a = a[ks[i]];
    }
    a[ks[ks.length - 1]] = v;
  }
  function presence(store, id, me, tab) {
    var key = 'pres_' + id, now = store.now(), map = {};
    try { map = JSON.parse(store.cacheGet(key) || '{}') || {}; } catch (e) { map = {}; }
    if (me && me.name) { map[String(me.name).slice(0, 60)] = { role: String(me.role || '').slice(0, 40), tab: String(tab || '').slice(0, 20), t: now }; }
    var out = [];
    Object.keys(map).forEach(function (n) { if (now - map[n].t < 40000) out.push({ name: n, role: map[n].role, tab: map[n].tab }); else delete map[n]; });
    store.cachePut(key, JSON.stringify(map));
    return out;
  }
  // when the case a chart uses was last edited (cached, so polling stays cheap)
  function caseVer(store, caseId) {
    if (!caseId || caseId === SAMPLE_ID) return 0;
    var v = store.cacheGet('casever_' + caseId);
    if (v != null) return +v || 0;
    var c = store.get('cases', caseId); var t = c ? (+c.updatedAt || 0) : 0;
    store.cachePut('casever_' + caseId, String(t));
    return t;
  }
  A.sync = function (store, r) {
    var id = recId(r.section, r.group);
    var who = presence(store, id, r.me, r.tab);
    var patches = Array.isArray(r.patches) ? r.patches : [], trail = Array.isArray(r.trail) ? r.trail : [];
    if (!patches.length && !trail.length) {
      // cheap path: nothing to save — only re-read the chart if its version moved
      var cv = store.cacheGet('ver_' + id);
      if (cv != null && +cv === +r.version) { var me0 = auth(store, r); return { unchanged: true, version: +cv, presence: who, caseVer: caseVer(store, me0.caseId) }; }
      var cur = auth(store, r);
      store.cachePut('ver_' + id, String(+cur.version || 0));
      return { version: +cur.version || 0, status: cur.status, data: cur.data, presence: who, grades: cur.released ? cur.grades : null, caseVer: caseVer(store, cur.caseId) };
    }
    return store.withLock(function () {
      var rec = auth(store, r);
      if (!practiceDone(rec) && rec.caseId !== SAMPLE_ID) err('Finish the practice chart first. Your graded task unlocks when your group signs the practice chart.');
      if (rec.status !== 'draft') return { rejected: true, version: +rec.version || 0, status: rec.status, data: rec.data, presence: who, grades: rec.released ? rec.grades : null, caseVer: caseVer(store, rec.caseId) };
      var d = rec.data;
      patches.forEach(function (p) {
        if (!p || typeof p.p !== 'string') return;
        if (p.p === '') { if (!d) d = p.v; return; }            // first save of a new chart: full baseline
        if (!d) d = {};
        if (p.p === 'trail' || p.p.indexOf('trail.') === 0) return; // the trail is append-only
        setPathIn(d, p.p, p.v);
      });
      if (trail.length) { d.trail = (Array.isArray(d.trail) ? d.trail : []).concat(trail.slice(0, 200)); if (d.trail.length > 1500) d.trail = d.trail.slice(-1500); }
      rec.data = d; rec.members = membersOf(d); rec.updatedAt = store.now();
      if (r.progress != null) rec.progress = +r.progress || 0;
      if (r.taskProgress) rec.taskProgress = r.taskProgress;
      rec.version = (+rec.version || 0) + 1;
      store.put('records', rec);
      store.cachePut('ver_' + id, String(rec.version));
      return { version: rec.version, status: rec.status, data: rec.data, presence: who, caseVer: caseVer(store, rec.caseId) };
    });
  };

  /* ----- staff: account ----- */
  A.staffLogin = function (store, r) {
    var id = clean(r.username, 40).toLowerCase();
    var u = store.get('instructors', id);
    store.slowDown();
    if (!u || u.active === false || u.pwHash !== pwHash(id, String(r.password || ''))) err('Wrong username or password.');
    var token = store.token();
    store.sessionPut(token, { username: id });
    return { token: token, user: userPublic(u), mustChange: !!u.mustChange };
  };
  A.me = function (store, r) { var u = staff(store, r); return { user: userPublic(u), mustChange: !!u.mustChange }; };
  A.logout = function (store, r) { if (r.token) store.sessionDel(r.token); return { ok: true }; };
  A.changePassword = function (store, r) {
    var u = staff(store, r);
    if (u.pwHash !== pwHash(u.id, String(r.oldPassword || ''))) err('Current password is wrong.');
    if (String(r.newPassword || '').length < 6) err('New password must be at least 6 characters.');
    u.pwHash = pwHash(u.id, r.newPassword); u.mustChange = false; store.put('instructors', u);
    return { ok: true };
  };

  /* ----- staff: sections ----- */
  A.mySections = function (store, r) {
    var u = staff(store, r);
    var recs = store.list('records');
    var cases = {};
    return mySections(store, u).map(function (s) {
      var c = s.caseId ? (cases[s.caseId] || (cases[s.caseId] = getCase(store, s.caseId))) : null;
      var mine = recs.filter(function (x) { return x.section === s.id; });
      return { code: s.id, instructor: s.instructor, groups: +s.groups || 0, caseId: s.caseId || '', caseTitle: c ? c.title : '',
        practiceCaseTitle: SAMPLE_CASE.title, gradedIsPractice: s.caseId === SAMPLE_ID,
        practiceDone: mine.filter(function (x) { return practiceDone(x); }).length,
        task5Unlocked: !!s.task5Unlocked, acceptingSubmissions: s.acceptingSubmissions !== false,
        charts: mine.length, submitted: mine.filter(function (x) { return x.status !== 'draft'; }).length };
    }).sort(function (a, b) { return a.code < b.code ? -1 : 1; });
  };
  A.updateSection = function (store, r) {
    var u = staff(store, r);
    var s = store.get('sections', secId(r.code));
    if (!s || !canSection(u, s)) err('Section not found or not yours.');
    var p = r.patch || {};
    if ('caseId' in p) {
      if (p.caseId === SAMPLE_ID) err('Lola Charing is the practice case for every section. Choose a different case for the graded task.');
      if (p.caseId) { var c = getCase(store, p.caseId); if (!c) err('Case not found.'); if (!c.builtin && c.owner !== u.id) err('You can only assign your own cases.'); }
      s.caseId = p.caseId || '';
    }
    if ('practiceCaseId' in p) {
      if (p.practiceCaseId) { var pc = getCase(store, p.practiceCaseId); if (!pc) err('Case not found.'); if (!pc.builtin && pc.owner !== u.id) err('You can only assign your own cases.'); }
      s.practiceCaseId = p.practiceCaseId || '';
    }
    if ('groups' in p) s.groups = checkGroups(store, s.id, p.groups);
    if ('task5Unlocked' in p) s.task5Unlocked = !!p.task5Unlocked;
    if ('acceptingSubmissions' in p) s.acceptingSubmissions = !!p.acceptingSubmissions;
    store.put('sections', s);
    return { ok: true };
  };

  function checkGroups(store, code, value) {
    var g = +value;
    if (!(g >= 1 && g <= 50) || Math.floor(g) !== g) err('Number of groups must be a whole number from 1 to 50.');
    var maxUsed = store.list('records').filter(function (x) { return x.section === code; }).reduce(function (m, x) { return Math.max(m, +x.group); }, 0);
    if (g < maxUsed) err('Group ' + maxUsed + ' already has a chart, so this section needs at least ' + maxUsed + ' groups.');
    return g;
  }

  /* ----- staff: charts ----- */
  A.list = function (store, r) {
    var u = staff(store, r);
    var codes = {}; mySections(store, u).forEach(function (s) { codes[s.id] = 1; });
    return { records: store.list('records').filter(function (x) { return codes[x.section]; }).map(function (x) { return recPublic(x, false); }) };
  };
  function myRecord(store, u, id) {
    var rec = store.get('records', id); if (!rec) err('Chart not found.');
    if (!canSection(u, store.get('sections', rec.section))) err('This chart belongs to another instructor\'s section.');
    return rec;
  }
  A.get = function (store, r, ks) {
    var u = staff(store, r); var rec = myRecord(store, u, r.id);
    return { record: recPublic(rec, true), case: getCase(store, rec.caseId, ks) };
  };
  A.grade = function (store, r) {
    var u = staff(store, r);
    return store.withLock(function () {
      var rec = myRecord(store, u, r.id);
      var g = r.grades || {}; g.gradedAt = store.now(); g.by = u.name || u.id;
      rec.grades = g; if (rec.status === 'submitted') rec.status = 'graded';
      if (typeof r.release === 'boolean') rec.released = r.release;
      rec.version = (+rec.version || 0) + 1; store.cachePut('ver_' + rec.id, String(rec.version));
      store.put('records', rec); return { ok: true };
    });
  };
  A.setStatus = function (store, r) {
    var u = staff(store, r);
    if (['draft', 'submitted', 'graded'].indexOf(r.status) < 0) err('Bad status');
    return store.withLock(function () {
      var rec = myRecord(store, u, r.id);
      rec.status = r.status; if (r.status === 'draft' && rec.data) rec.data.signed = null;
      rec.version = (+rec.version || 0) + 1; store.cachePut('ver_' + rec.id, String(rec.version));
      store.put('records', rec); return { ok: true };
    });
  };
  A.practiceDone = function (store, r) {
    return store.withLock(function () {
      var rec = auth(store, r);
      if ((+r.progress || 0) < PRACTICE_MIN) err('Complete at least ' + PRACTICE_MIN + '% of the practice chart first.');
      if (!rec.practiceDoneAt) {
        rec.practiceDoneAt = store.now(); rec.practiceBy = String(r.by || '').slice(0, 60); rec.practiceProgress = +r.progress || 0;
        rec.version = (+rec.version || 0) + 1; store.put('records', rec); store.cachePut('ver_' + rec.id, String(rec.version));
      }
      return { practiceDoneAt: rec.practiceDoneAt };
    });
  };
  A.waivePractice = function (store, r) {
    var u = staff(store, r);
    return store.withLock(function () {
      var rec = myRecord(store, u, r.id);
      if (!rec.practiceDoneAt) { rec.practiceDoneAt = store.now(); rec.practiceWaivedBy = u.name || u.id; rec.version = (+rec.version || 0) + 1; store.put('records', rec); store.cachePut('ver_' + rec.id, String(rec.version)); }
      return { ok: true };
    });
  };
  A.remove = function (store, r) {
    var u = staff(store, r); myRecord(store, u, r.id);
    store.remove('records', r.id); return { ok: true };
  };

  /* ----- staff: cases (each instructor owns their own) ----- */
  A.listCases = function (store, r) {
    var u = staff(store, r);
    var secs = store.list('sections');
    var mine = store.list('cases').filter(function (c) { return c.owner === u.id; });
    var all = [SAMPLE_CASE, SAMPLE_DM].concat(mine);
    return all.map(function (c) {
      return { id: c.id, title: c.title, owner: c.owner || '', builtin: !!c.builtin, updatedAt: c.updatedAt || null,
        patient: c.patient ? c.patient.name : '', dx: c.patient ? c.patient.dx : '', cards: (c.cards || []).length,
        // only reveal sections this user may see (other instructors' sections stay private)
        usedBy: secs.filter(function (s) { return s.caseId === c.id && canSection(u, s); }).map(function (s) { return s.id; })
 };
    });
  };
  A.getCaseFull = function (store, r, ks) {
    var u = staff(store, r);
    var c = getCase(store, r.id, ks); if (!c) err('Case not found.');
    if (!c.builtin && c.owner !== u.id) err('This case belongs to another instructor.');
    return { case: c };
  };
  A.saveCase = function (store, r) {
    var u = staff(store, r);
    var c = r.case || {}; var now = store.now();
    if (!String(c.title || '').trim()) err('Give the case a title.');
    if (BUILTINS[c.id]) err('Built-in cases are read-only. Duplicate it first.');
    if (c.id) {
      var old = store.get('cases', c.id); if (!old) err('Case not found.');
      if (old.owner !== u.id) err('This case belongs to another instructor.');
      c.owner = old.owner; c.createdAt = old.createdAt;
    } else { c.id = 'case-' + store.token().slice(0, 10); c.owner = u.id; c.createdAt = now; }
    delete c.builtin; c.updatedAt = now;
    store.put('cases', c);
    store.cachePut('casever_' + c.id, String(now));   // open charts notice the edit
    return { id: c.id, updatedAt: now };
  };
  A.duplicateCase = function (store, r, ks) {
    var u = staff(store, r);
    var src = r.id === 'blank' ? blankCase() : getCase(store, r.id, ks); if (!src) err('Case not found.');
    if (!src.builtin && src.owner && src.owner !== u.id) err('This case belongs to another instructor.');
    var c = clone(src); delete c.id; delete c.builtin;
    c.title = r.id === 'blank' ? 'Untitled case' : 'Copy of ' + src.title;
    return A.saveCase(store, { token: r.token, case: c });
  };
  A.deleteCase = function (store, r) {
    var u = staff(store, r);
    var c = store.get('cases', r.id); if (!c) err('Case not found.');
    if (c.owner !== u.id) err('This case belongs to another instructor.');
    var used = store.list('sections').filter(function (s) { return s.caseId === c.id || s.practiceCaseId === c.id; }).map(function (s) { return s.id + (s.caseId === c.id ? '' : ' (practice)'); });
    if (used.length) err('This case is assigned to ' + used.join(', ') + '. Assign another case first.');
    if (store.list('records').some(function (x) { return x.caseId === c.id; })) err('Student charts already use this case, so it cannot be deleted. Duplicate it to make changes.');
    store.remove('cases', r.id); return { ok: true };
  };

  /* ----- admin: instructors & sections ----- */
  A.adminData = function (store, r) {
    staff(store, r, true);
    var recs = store.list('records');
    return {
      instructors: store.list('instructors').map(function (u) { var o = userPublic(u); o.sections = store.list('sections').filter(function (s) { return s.instructor === u.id; }).map(function (s) { return s.id; }); return o; }),
      sections: store.list('sections').map(function (s) { var c = s.caseId ? getCase(store, s.caseId) : null; return { code: s.id, instructor: s.instructor, groups: +s.groups || 0, caseTitle: c ? c.title : '', practiceCaseTitle: SAMPLE_CASE.title, charts: recs.filter(function (x) { return x.section === s.id; }).length }; })
    };
  };
  A.saveInstructor = function (store, r) {
    var me = staff(store, r, true);
    var id = clean(r.username, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(id)) err('Username: 3–40 letters, numbers, dot, dash or underscore.');
    var u = store.get('instructors', id);
    if (r.isNew && u) err('That username is taken.');
    if (!u) { u = { id: id, createdAt: store.now() }; if (!r.password) err('Set a temporary password for the new account.'); }
    if (r.name != null) u.name = String(r.name).trim().slice(0, 80) || id;
    if (r.role) u.role = r.role === 'admin' ? 'admin' : 'instructor';
    if (typeof r.active === 'boolean') { if (id === me.id && !r.active) err('You cannot disable your own account.'); u.active = r.active; }
    if (r.password) { if (String(r.password).length < 6) err('Password must be at least 6 characters.'); u.pwHash = pwHash(id, r.password); u.mustChange = id !== me.id; }
    store.put('instructors', u);
    return { ok: true };
  };
  A.deleteInstructor = function (store, r) {
    var me = staff(store, r, true);
    var id = clean(r.username, 40).toLowerCase();
    if (id === me.id) err('You cannot delete your own account.');
    if (store.list('sections').some(function (s) { return s.instructor === id; })) err('Reassign this instructor\'s sections first.');
    store.remove('instructors', id); return { ok: true };
  };
  A.saveSection = function (store, r) {
    staff(store, r, true);
    var code = secId(r.code);
    if (!/^[A-Z0-9-]{2,20}$/.test(code)) err('Section code: 2–20 letters, numbers or dashes (e.g., BSN3A).');
    var s = store.get('sections', code);
    if (r.isNew && s) err('Section ' + code + ' already exists.');
    if (!s) s = { id: code, caseId: SAMPLE_DM_ID, practiceCaseId: SAMPLE_ID, groups: 0, task5Unlocked: false, acceptingSubmissions: true };
    var inst = store.get('instructors', clean(r.instructor, 40).toLowerCase());
    if (!inst) err('Choose an instructor.');
    s.instructor = inst.id;
    store.put('sections', s); return { ok: true };
  };
  A.deleteSection = function (store, r) {
    staff(store, r, true);
    var code = secId(r.code);
    if (store.list('records').some(function (x) { return x.section === code; })) err('This section already has student charts. Delete those first.');
    store.remove('sections', code); return { ok: true };
  };

  /* ---------------- dispatcher ---------------- */
  function handle(store, req, keyStore) {
    var fn = A[req && req.action];
    if (!fn) err('Unknown action');
    return fn(store, req, keyStore || {});
  }

  /* first-run seeding: an admin account (+ demo data when asked) */
  function seed(store, opts) {
    opts = opts || {};
    if (store.list('instructors').length) return false;
    var adminPw = opts.adminPassword || 'admin123';
    store.put('instructors', { id: 'admin', name: 'Administrator', role: 'admin', active: true, pwHash: pwHash('admin', adminPw), mustChange: !opts.demo, createdAt: store.now() });
    if (opts.demo) {
      store.put('instructors', { id: 'mreyes', name: 'Prof. M. Reyes', role: 'instructor', active: true, pwHash: pwHash('mreyes', 'demo123'), createdAt: store.now() });
      store.put('instructors', { id: 'jcruz', name: 'Prof. J. Cruz', role: 'instructor', active: true, pwHash: pwHash('jcruz', 'demo123'), createdAt: store.now() });
      store.put('sections', { id: 'BSN3A', instructor: 'mreyes', groups: 6, caseId: SAMPLE_DM_ID, practiceCaseId: SAMPLE_ID, task5Unlocked: false, acceptingSubmissions: true });
      store.put('sections', { id: 'BSN3B', instructor: 'mreyes', groups: 5, caseId: SAMPLE_DM_ID, practiceCaseId: SAMPLE_ID, task5Unlocked: false, acceptingSubmissions: true });
      store.put('sections', { id: 'BSN3C', instructor: 'jcruz', groups: 6, caseId: SAMPLE_DM_ID, practiceCaseId: SAMPLE_ID, task5Unlocked: false, acceptingSubmissions: true });
    }
    return true;
  }

  return { handle: handle, seed: seed, sha256: sha256, SAMPLE_ID: SAMPLE_ID, SAMPLE_CASE: SAMPLE_CASE, SAMPLE_DM_ID: SAMPLE_DM_ID, SAMPLE_DM: SAMPLE_DM, BUILTINS: BUILTINS, PRACTICE_MIN: PRACTICE_MIN, blankCase: blankCase, recId: recId };
})();
if (typeof window !== 'undefined') window.EHRCore = EHRCore;

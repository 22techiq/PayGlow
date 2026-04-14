
/*********************************
 * 🧠 DETECT WEBHOOK REQUEST
 *********************************/
function isWebhookRequest(e){
  try{
    const body = JSON.parse(e.postData.contents);
    return body && body.invoice_id;
  }catch{
    return false;
  }
}

/*********************************
 * 🔐 INTASEND WEBHOOK HANDLER
 *********************************/
function handleWebhookStandalone(e){

  const data = JSON.parse(e.postData.contents);

  /* =========================
     VERIFY SIGNATURE
  ========================= */
  const signature = e.parameter.signature || "";

  if(!verifyIntaSendSignature(e.postData.contents, signature)){
    throw new Error("Invalid webhook signature");
  }

  /* =========================
     ONLY SUCCESSFUL PAYMENTS
  ========================= */
  if(data.state !== "COMPLETE"){
    return respond({status:"ignored"});
  }

  const name = data.first_name || "Customer";
  const email = data.email || "";
  const phone = data.phone_number || "";
  const amount = Number(data.value);
  const reference = data.invoice_id;

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SHEET_NAME);

  /* =========================
     PREVENT DUPLICATES
  ========================= */
  const rows = sheet.getDataRange().getValues();

  for(let i=1;i<rows.length;i++){
    if(rows[i][1] == reference){
      return respond({status:"duplicate"});
    }
  }

  /* =========================
     SAVE VERIFIED PAYMENT
  ========================= */
  sheet.appendRow([
    new Date(),
    reference,
    name,
    email,
    phone,
    amount,
    "COMPLETE"
  ]);

  /* =========================
     EMAIL + ADMIN
  ========================= */
  sendReceipt(email,name,amount,reference);
  notifyAdmins(name,amount,email,phone);

  return respond({status:"saved"});
}

/*********************************
 * 🔐 VERIFY WEBHOOK SIGNATURE
 *********************************/
const INTASEND_SECRET = "YOUR_WEBHOOK_SECRET";

function verifyIntaSendSignature(payload, signature){

  const expected = Utilities.computeHmacSha256Signature(
    payload,
    INTASEND_SECRET
  );

  const expectedHex = expected.map(b=>{
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0"+v : v;
  }).join("");

  return expectedHex === signature;
}









/*********************************
 * 🌍 ORIGIN CHECK (APPENDED SAFE)
 *********************************/
(function(){

  const ALLOWED_ORIGIN = "https://yourdomain.com"; // 🔴 change this

  const origin = e.parameter.origin || "";

  if(origin !== ALLOWED_ORIGIN){
    throw new Error("Blocked request: invalid origin");
  }

})();






formData.append("origin", window.location.origin);

/*********************************
 * ⚙️ CONFIG
 *********************************/
const SHEET_NAME = "PAYMENTS";
const ADMIN_EMAILS = ["22techiq@gmail.com","mc.owino254@gmail.com"];
const RECAPTCHA_SECRET = "6Ld";

/*********************************
 * 🚀 MAIN ENTRY (POST)
 *********************************/
function doPost(e){

  try{

    const data = JSON.parse(e.postData.contents);

    const name = (data.name || "").trim();
    const email = (data.email || "").trim();
    const phone = (data.phone || "").trim();
    const amount = Number(data.amount);
    const token = data.token;
    const ip = e.parameter.ip || "UNKNOWN";

    /* =========================
       VALIDATION
    ========================= */
    if(!name || name.length < 2)
      return respond({status:"error",message:"Invalid name"});

    if(!email.includes("@"))
      return respond({status:"error",message:"Invalid email"});

    if(!phone || phone.length < 8)
      return respond({status:"error",message:"Invalid phone"});

    if(!amount || amount < 10)
      return respond({status:"error",message:"Invalid amount"});

    /* =========================
       RECAPTCHA VERIFY
    ========================= */
    if(!verifyCaptcha(token))
      return respond({status:"error",message:"Captcha failed"});

    /* =========================
       RATE LIMIT + FRAUD
    ========================= */
    if(isBlocked(ip)){
      return respond({status:"error",message:"Too many attempts"});
    }

    /* =========================
       SAVE TO SHEET
    ========================= */
    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(SHEET_NAME);

    sheet.appendRow([
      name,
      email,
      phone,
      amount,
      ip,
      "COMPLETE",
      new Date()
    ]);

    /* =========================
       EMAIL RECEIPT
    ========================= */
    sendReceipt(email,name,amount);

    /* =========================
       ADMIN ALERT
    ========================= */
    notifyAdmins(name,amount,email,phone);

    return respond({status:"success"});

  }catch(err){
    return respond({status:"error",message:err.toString()});
  }
}

/*********************************
 * 📥 GET DATA + PDF
 *********************************/
function doGet(e){

  if(e.parameter.type === "pdf"){
    return generatePDF();
  }

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SHEET_NAME);

  const data = sheet.getDataRange().getValues();

  let result = [];

  for(let i=1;i<data.length;i++){
    result.push({
      name: data[i][0],
      email: data[i][1],
      phone: data[i][2],
      amount: data[i][3],
      date: data[i][6]
    });
  }

  return ContentService.createTextOutput(
    JSON.stringify(result)
  ).setMimeType(ContentService.MimeType.JSON);
}

/*********************************
 * 🔐 CAPTCHA VERIFY
 *********************************/
function verifyCaptcha(token){

  const url = "https://www.google.com/recaptcha/api/siteverify";

  const res = UrlFetchApp.fetch(url,{
    method:"post",
    payload:{
      secret: RECAPTCHA_SECRET,
      response: token
    }
  });

  const json = JSON.parse(res.getContentText());

  return json.success === true;
}

/*********************************
 * 🚫 RATE LIMIT / BLOCK
 *********************************/
function isBlocked(ip){

  const cache = CacheService.getScriptCache();
  const key = "IP_"+ip;

  let attempts = cache.get(key);

  if(!attempts){
    cache.put(key,"1",60); // 1 min
    return false;
  }

  attempts = Number(attempts) + 1;

  cache.put(key,attempts,60);

  if(attempts > 5){
    return true;
  }

  return false;
}

/*********************************
 * 📧 DONOR RECEIPT
 *********************************/
function sendReceipt(email,name,amount){

  const subject = "🎉 Payment Received - Thank You!";
  const body = `
Hello ${name},

Thank you for your contribution 💙

Amount: KES ${amount}

Your support helps keep innovation alive 🚀

— PayGlow Team
  `;

  MailApp.sendEmail(email,subject,body);
}

/*********************************
 * 📢 ADMIN NOTIFICATION
 *********************************/
function notifyAdmins(name,amount,email,phone){

  const subject = "💰 New Donation Received";

  const body = `
New Donation Alert 🚀

Name: ${name}
Amount: KES ${amount}
Email: ${email}
Phone: ${phone}
  `;

  ADMIN_EMAILS.forEach(admin=>{
    MailApp.sendEmail(admin,subject,body);
  });
}

/*********************************
 * 📄 PDF GENERATION
 *********************************/
function generatePDF(){

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SHEET_NAME);

  const data = sheet.getDataRange().getValues();

  let html = `
    <h1 style="text-align:center;">PayGlow Report</h1>
    <table border="1" width="100%" cellpadding="6">
      <tr>
        <th>Name</th>
        <th>Email</th>
        <th>Phone</th>
        <th>Amount</th>
        <th>Date</th>
      </tr>
  `;

  let total = 0;

  for(let i=1;i<data.length;i++){
    total += Number(data[i][3]);

    html += `
      <tr>
        <td>${data[i][0]}</td>
        <td>${data[i][1]}</td>
        <td>${data[i][2]}</td>
        <td>KES ${data[i][3]}</td>
        <td>${data[i][6]}</td>
      </tr>
    `;
  }

  html += `</table><h3>Total: KES ${total}</h3>`;

  const blob = Utilities.newBlob(html,"text/html")
    .getAs("application/pdf")
    .setName("PayGlow_Report.pdf");

  return blob;
}

/*********************************
 * 📤 RESPONSE HELPER
 *********************************/
function respond(obj){
  return ContentService.createTextOutput(
    JSON.stringify(obj)
  ).setMimeType(ContentService.MimeType.JSON);
}

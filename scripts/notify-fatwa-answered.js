const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Resend } = require('resend');
const dotenv = require('dotenv');


const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env file not found at project root. Please create one with RESEND_API_KEY=your_key');
  process.exit(1);
}
dotenv.config({ path: envPath });

if (!process.env.RESEND_API_KEY) {
  console.error('❌ RESEND_API_KEY is not set in the .env file. Please add RESEND_API_KEY=your_key');
  process.exit(1);
}
if (!process.env.NOTIFY_EMAIL_PRIMARY || !process.env.NOTIFY_EMAIL_DEV) {
  console.error('❌ NOTIFY_EMAIL_PRIMARY and NOTIFY_EMAIL_DEV must be set in the .env file');
  process.exit(1);
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL_PRIMARY = process.env.NOTIFY_EMAIL_PRIMARY;
const NOTIFY_EMAIL_DEV = process.env.NOTIFY_EMAIL_DEV;
const FROM_EMAIL = 'noreply@notifications.ebrahimalzaabi.com';
const isDryRun = process.argv.includes('--dry-run');
const BCC_EMAILS = isDryRun
  ? [NOTIFY_EMAIL_DEV]
  : [NOTIFY_EMAIL_DEV, NOTIFY_EMAIL_PRIMARY];

const resend = new Resend(RESEND_API_KEY);

const fatwaId = process.argv[2];
if (!fatwaId) {
  console.error('❌ Usage: node notify-fatwa-answered.js <fatwa-id>');
  console.error('   Example: node notify-fatwa-answered.js 2026-03-12-3270');
  process.exit(1);
}

const fatwaPath = path.join(__dirname, '..', 'content', 'fatawa', 'posts', `${fatwaId}.md`);
if (!fs.existsSync(fatwaPath)) {
  console.error(`❌ Fatwa file not found: ${fatwaPath}`);
  process.exit(1);
}

const content = fs.readFileSync(fatwaPath, 'utf8');

function parseFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  
  const frontMatter = match[1];
  const data = {};
  
  let currentKey = null;
  let multilineValue = '';
  let inMultiline = false;
  
  for (const line of frontMatter.split('\n')) {
    if (inMultiline) {
      if (line.match(/^\S/) && !line.startsWith('    ') && !line.startsWith('<')) {
        data[currentKey] = multilineValue.trim();
        inMultiline = false;
      } else {
        multilineValue += line.replace(/^    /, '') + '\n';
        continue;
      }
    }
    
    const keyMatch = line.match(/^(\w+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2];
      if (value === '|') {
        inMultiline = true;
        multilineValue = '';
      } else {
        data[currentKey] = value.replace(/^["']|["']$/g, '');
      }
    }
  }
  
  if (inMultiline && currentKey) {
    data[currentKey] = multilineValue.trim();
  }
  
  return data;
}

const frontMatter = parseFrontMatter(content);
const title = frontMatter.title || 'بدون عنوان';
const question = frontMatter.question || '';
const youtube = frontMatter.youtube || '';

console.log('📄 Fatwa:', fatwaId);
console.log('📝 Title:', title);
console.log('🔗 YouTube:', youtube || '(none)');

const questionText = question.replace(/<[^>]*>/g, '').trim();
const fatwaUrl = `https://ebrahimalzaabi.com/fatawa/posts/${fatwaId}/`;

function buildHtmlEmail() {

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:'Geeza Pro','Al Nile','Traditional Arabic','Simplified Arabic','Arial',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
          
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#C5A059 0%,#a8864a 100%);padding:30px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,0.2);">
                موقع الشيخ إبراهيم سيف الزعابي
              </h1>
            </td>
          </tr>
          
          <!-- Success Badge -->
          <tr>
            <td style="padding:30px 40px 20px;text-align:center;">
              <div style="display:inline-block;background:#e8f5e9;border:2px solid #4caf50;border-radius:50px;padding:12px 30px;">
                <span style="color:#2e7d32;font-size:18px;font-weight:600;">✓ تمت الإجابة على سؤالك</span>
              </div>
            </td>
          </tr>
          
          <!-- Title -->
          <tr>
            <td style="padding:10px 40px 20px;text-align:center;">
              <h2 style="margin:0;color:#2c3e50;font-size:22px;line-height:1.6;font-weight:700;">
                ${title}
              </h2>
            </td>
          </tr>
          
          <!-- Question Box -->
          <tr>
            <td style="padding:0 40px 25px;">
              <div style="background:#fdf8f0;border-right:4px solid #C5A059;border-radius:8px;padding:20px 25px;text-align:right;direction:rtl;">
                <p style="margin:0 0 10px;color:#C5A059;font-size:14px;font-weight:600;text-align:right;">السؤال:</p>
                <p style="margin:0;color:#555;font-size:16px;line-height:1.8;text-align:right;direction:rtl;">
                  ${questionText}
                </p>
              </div>
            </td>
          </tr>
          
          <!-- CTA Buttons -->
          <tr>
            <td style="padding:0 40px 30px;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding:5px;">
                    <a href="${fatwaUrl}" style="display:inline-block;background:#C5A059;color:#fff;padding:14px 35px;border-radius:8px;text-decoration:none;font-size:17px;font-weight:600;box-shadow:0 4px 12px rgba(197,160,89,0.4);">
                      قراءة الفتوى كاملة
                    </a>
                  </td>
                  ${youtube ? `<td style="padding:5px;">
                    <a href="${youtube}" style="display:inline-block;background:#f5f5f5;color:#333;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:17px;font-weight:600;border:1px solid #e0e0e0;">
                      شاهد الفتوى على يوتيوب
                    </a>
                  </td>` : ''}
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fa;padding:25px 40px;text-align:center;border-top:1px solid #eee;">
              <p style="margin:0 0 10px;color:#888;font-size:14px;">
                جزاكم الله خيراً 
              </p>
              <a href="https://ebrahimalzaabi.com" style="color:#C5A059;text-decoration:none;font-size:14px;font-weight:600;">
                ebrahimalzaabi.com
              </a>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function buildTextEmail() {
  let text = `تمت الإجابة على سؤالك\n\n`;
  text += `العنوان: ${title}\n\n`;
  text += `السؤال:\n${questionText}\n\n`;
  text += `رابط الفتوى:\n${fatwaUrl}`;
  if (youtube) {
    text += `\n\nرابط الفيديو:\n${youtube}`;
  }
  return text;
}

async function sendEmail(recipientEmail) {
  const subject = `تمت الإجابة على سؤال: ${title}`;

  try {
    await resend.emails.send({
      from: `موقع الشيخ إبراهيم الزعابي <${FROM_EMAIL}>`,
      to: recipientEmail,
      bcc: BCC_EMAILS,
      subject: subject,
      html: buildHtmlEmail(),
      text: buildTextEmail()
    });
    console.log('✅ Email sent successfully to:', recipientEmail);
    if (isDryRun) console.log('   ⚠️ DRY RUN mode (BCC only to ' + NOTIFY_EMAIL_DEV + ')');
    if (BCC_EMAILS.length) console.log('   BCC:', BCC_EMAILS.join(', '));
  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
  }
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const email = await new Promise(resolve => rl.question('📧 Enter recipient email: ', resolve));
  rl.close();

  if (!email || !email.includes('@')) {
    console.error('❌ Invalid email address');
    process.exit(1);
  }

  await sendEmail(email.trim());
}

main().catch(console.error);

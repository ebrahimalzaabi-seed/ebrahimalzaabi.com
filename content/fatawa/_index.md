---
title: "الفتاوى"
featured_image: "/images/hero.jpg"
---

## أرسل سؤالك الشرعي

<form id="question-form" style="max-width:400px;margin-top:2em;direction:rtl;text-align:right;">
  <label for="sender_name">الاسم:</label><br>
  <input type="text" id="sender_name" name="sender_name" required style="width:100%;margin-bottom:1em;"><br>
  <label for="reply_to">البريد الإلكتروني (لإشعارك عند الإجابة):</label><br>
  <input type="email" id="reply_to" name="reply_to" required style="width:100%;margin-bottom:1em;" placeholder="example@email.com" dir="ltr"><br>
  <label for="title">عنوان السؤال:</label><br>
  <input type="text" id="title" name="title" required style="width:100%;margin-bottom:1em;" placeholder="مثال: حكم التسبيح بالسبحة الالكترونية"><br>
  <label for="message">تفاصيل السؤال:</label><br>
  <textarea id="message" name="message" rows="5" required style="width:100%;margin-bottom:1em;"></textarea><br>
  <input type="text" name="_gotcha" style="display:none;" tabindex="-1" autocomplete="off">
  <div class="cf-turnstile" data-sitekey="0x4AAAAAACq119Sz-4ellK8N" data-theme="light" style="margin-bottom:1em;"></div>
  <button type="submit" style="width:100%;">إرسال</button>
  <div id="form-status" style="margin-top:1em;"></div>
</form>
<script>
if (window.location.hostname === 'localhost') {
  var devNote = document.createElement('div');
  var isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  devNote.style.cssText = isDark
    ? 'background:#3a3000;color:#ffc107;border:1px solid #665500;border-radius:6px;padding:10px 14px;margin-top:1em;max-width:400px;font-size:0.9em;direction:ltr;text-align:left;'
    : 'background:#fff3cd;color:#856404;border:1px solid #ffc107;border-radius:6px;padding:10px 14px;margin-top:1em;max-width:400px;font-size:0.9em;direction:ltr;text-align:left;';
  devNote.textContent = 'Dev mode: notification emails will only be sent to the dev email (the primary email will not receive them).';
  document.getElementById('question-form').after(devNote);
}
</script>

<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<script type="text/javascript">
document.addEventListener('DOMContentLoaded', function() {
  var form = document.getElementById('question-form');
  var status = document.getElementById('form-status');
  var button = form.querySelector('button[type="submit"]');
  var nameField = document.getElementById('sender_name');
  var emailField = document.getElementById('reply_to');

  var savedName = localStorage.getItem('fatawa_sender_name');
  var savedEmail = localStorage.getItem('fatawa_sender_email');
  if (savedName) nameField.value = savedName;
  if (savedEmail) emailField.value = savedEmail;

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    status.textContent = '...جاري الإرسال';
    button.disabled = true;

    var turnstileInput = document.querySelector('[name="cf-turnstile-response"]');
    var turnstileToken = turnstileInput ? turnstileInput.value : '';
    if (!turnstileToken) {
      status.style.color = 'red';
      status.textContent = 'يرجى انتظار تحميل التحقق ثم المحاولة مرة أخرى.';
      button.disabled = false;
      return;
    }

    fetch('https://blue-dew-502c.ebrahimalzaabi-seed.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nameField.value,
        email: emailField.value,
        title: document.getElementById('title').value,
        message: document.getElementById('message').value,
        dryRun: window.location.hostname === 'localhost',
        'cf-turnstile-response': turnstileToken
      })
    })
    .then(function(res) {
      if (!res.ok) {
        return res.text().then(function(t) { console.error('Response:', res.status, t); throw new Error(t); });
      }
      return res.json();
    })
    .then(function(data) {
      if (data.success) {
        localStorage.setItem('fatawa_sender_name', nameField.value);
        localStorage.setItem('fatawa_sender_email', emailField.value);
        status.style.color = 'green';
        status.innerHTML = 'تم إرسال سؤالك بنجاح. سيصلك بريد إلكتروني عند الإجابة على سؤالك إن شاء الله.';
        document.getElementById('title').value = '';
        document.getElementById('message').value = '';
        if (typeof turnstile !== 'undefined') turnstile.reset();
      } else {
        status.style.color = 'red';
        status.textContent = 'خطأ في الإرسال. حاول مرة أخرى.';
      }
      button.disabled = false;
    })
    .catch(function(error) {
      status.style.color = 'red';
      status.textContent = 'خطأ في الإرسال. حاول مرة أخرى.';
      console.error('Send error:', error);
      button.disabled = false;
      if (typeof turnstile !== 'undefined') turnstile.reset();
    });
  });
});
</script>

<hr style="margin:2em 0;">

## تصفح الفتاوى حسب التصنيف

{{< category-list >}} 

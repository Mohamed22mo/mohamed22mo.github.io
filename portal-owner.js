/* بوابة العملاء — جانب صاحب البرنامج (يعمل مع Firebase)
   - إنشاء حسابات العملاء ونشر كشف الحساب والنقاط والمنتجات
   - استقبال طلبات المتجر مع الإشعارات */
(function(){
'use strict';
var FB = window.HISAB_FB;
if (!FB) return;

var S = null;                       // وحدات Firebase بعد التحميل
var P = { user:null, orders:[], signups:[], resets:[], first:true, f2:true, f3:true, unsub:null, unsub2:null, unsub3:null, timer:null, busy:false, msg:'', pubAt:'' };
var HASH_KEY = 'hisab_portal_hash', SEEN_KEY = 'hisab_portal_seen';
var hashes = {}; try{ hashes = JSON.parse(localStorage.getItem(HASH_KEY) || '{}'); }catch(e){}
function saveHashes(){ try{ localStorage.setItem(HASH_KEY, JSON.stringify(hashes)); }catch(e){} }
function el(id){ return document.getElementById(id); }
function h(s){ return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function money(n){ return (typeof fmt === 'function') ? fmt(n) : String(n); }
function portalDb(){ db.portal = db.portal || { accounts:{} }; db.portal.accounts = db.portal.accounts || {}; return db.portal; }
function errText(e){
  var c = (e && e.code) || '';
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found') return 'كلمة المرور غير صحيحة أو الحساب غير موجود';
  if (c === 'auth/network-request-failed' || c === 'unavailable') return 'لا يوجد اتصال بالإنترنت';
  if (c === 'auth/too-many-requests') return 'محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة';
  if (c === 'auth/invalid-api-key' || c === 'auth/api-key-not-valid.-please-pass-a-valid-api-key.') return 'مفتاح Firebase في ملف fb-config.js غير صحيح';
  if (c === 'permission-denied') return 'قواعد الأمان لم تُضبط بعد أو أن الدخول ليس بحساب صاحب البرنامج';
  return (e && (e.message || c)) || 'خطأ غير معروف';
}

/* ---------- تحميل Firebase ---------- */
async function sdk(){
  if (S) return S;
  var base = FB.sdk;
  var m = await Promise.all([ import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js') ]);
  var app = m[0].initializeApp(FB.config, 'owner');
  var auth = m[1].getAuth(app);
  var fs = m[2].initializeFirestore(app, { experimentalAutoDetectLongPolling:true, ignoreUndefinedProperties:true });
  S = { A:m[0], U:m[1], F:m[2], app:app, auth:auth, fs:fs };
  S.U.onAuthStateChanged(auth, onAuth);
  return S;
}
function isOwner(){ return !!(P.user && P.user.email === FB.ownerEmail); }

function onAuth(u){
  P.user = u || null;
  if (u && u.email !== FB.ownerEmail){ P.msg = 'هذا الحساب ليس حساب صاحب البرنامج'; S.U.signOut(S.auth); return; }
  [ 'unsub', 'unsub2', 'unsub3' ].forEach(function(k){ if (P[k]){ try{ P[k](); }catch(e){} P[k] = null; } });
  P.orders = []; P.signups = []; P.resets = []; P.first = true; P.f2 = true; P.f3 = true;
  if (isOwner()) startOrders();
  render();
  if (isOwner()) setTimeout(function(){ publishAll(false); publishCatalog(false); }, 1500);
}

async function login(){
  var pw = (el('pt-pw') || {}).value || '';
  if (!pw) return say('اكتب كلمة المرور');
  P.msg = 'جارٍ الدخول…'; render();
  try{ await sdk(); await S.U.signInWithEmailAndPassword(S.auth, FB.ownerEmail, pw); P.msg = ''; }
  catch(e){ P.msg = errText(e); render(); }
}
async function logout(){ try{ await sdk(); await S.U.signOut(S.auth); }catch(e){} }

/* ---------- نشر بيانات العملاء ---------- */
function custData(c){
  var name = c.name, b = statementCalc(name), k = cashbackSummary(name);
  var rows = b.items.map(function(i){ return { d:i.o.date || '', t:i.o.desc || 'عملية', a:r2(i.o.price) }; });
  var sum = rows.reduce(function(s,x){ return s + x.a; }, 0);
  var prev = r2(Math.max(0, b.owed - sum));
  if (prev > 0.004) rows.unshift({ d:'', t:'مديونية سابقة', a:prev });
  var pays = db.pays.filter(function(p){ return p.name === name && !p.cashback && (+p.amount) > 0; })
                    .sort(function(x,y){ return (y.id||0) - (x.id||0); }).slice(0, 8)
                    .map(function(p){ return { d:p.date || '', a:r2(p.amount) }; });
  return { name:name, owed:r2(b.owed), credit:r2(b.credit), due:r2(Math.max(0, b.owed - b.credit)),
           rows:rows.slice(-250), pays:pays,
           pts:{ avail:k.available, value:k.value, paid:k.paid, year:k.year } };
}
async function publishAll(manual){
  if (!isOwner() || P.busy) return;
  var acc = portalDb().accounts, keys = Object.keys(acc);
  if (!keys.length){ if (manual) say('لا توجد حسابات عملاء بعد'); return; }
  P.busy = true;
  try{
    var batch = S.F.writeBatch(S.fs), n = 0, newHash = {};
    db.customers.forEach(function(c){
      var ph = FB.normPhone(phoneOf(c)); var rec = ph && acc[ph];
      if (!rec || c.excluded || !rec.uid) return;
      var d = custData(c); d.phone = ph; d.uid = rec.uid;
      var hs = JSON.stringify(d);
      if (hashes['c:' + ph] === hs && !manual) return;
      d.upd = new Date().toISOString();
      batch.set(S.F.doc(S.fs, 'customers', ph), d);
      newHash['c:' + ph] = hs; n++;
    });
    if (n){ await batch.commit(); Object.keys(newHash).forEach(function(k){ hashes[k] = newHash[k]; }); saveHashes(); }
    P.pubAt = new Date().toLocaleTimeString('ar-EG');
    if (manual) say(n ? 'تم نشر بيانات ' + n + ' عميل' : 'البيانات منشورة ولا يوجد جديد');
  }catch(e){ P.msg = errText(e); if (manual) uiAlert('تعذر النشر: ' + errText(e)); }
  P.busy = false; render();
}

/* ---------- نشر المنتجات ---------- */
function thumb(src){
  return new Promise(function(res){
    try{
      if (!src || src.length > 900000) return res('');
      var im = new Image();
      im.onload = function(){
        var M = 360, k = Math.min(1, M / Math.max(im.width, im.height));
        var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.72));
      };
      im.onerror = function(){ res(''); };
      im.src = src;
    }catch(e){ res(''); }
  });
}
async function publishCatalog(manual){
  if (!isOwner() || P.busy) return;
  P.busy = true;
  try{
    var prods = getProducts().filter(function(p){ return p.sale > 0; });
    var ids = {}, ops = [];
    for (var i = 0; i < prods.length; i++){
      var p = prods[i], m = pmeta(p.name), code = m.code, img = (typeof PIMG !== 'undefined' && PIMG[code]) ? PIMG[code] : '';
      ids[code] = true;
      var sig = JSON.stringify([p.name, r2(p.sale), m.details || '', img ? img.length : 0]);
      if (!manual && hashes['p:' + code] === sig) continue;
      var d = { name:p.name, price:r2(p.sale), details:m.details || '', active:true, sort:i };
      d.img = img ? await thumb(img) : '';
      ops.push({ code:code, d:d, sig:sig });
    }
    var existing = await S.F.getDocs(S.F.collection(S.fs, 'catalog'));
    var stale = []; existing.forEach(function(x){ if (!ids[x.id]) stale.push(x.id); });
    var all = ops.map(function(o){ return { t:'set', o:o }; }).concat(stale.map(function(id){ return { t:'del', id:id }; }));
    for (var s = 0; s < all.length; s += 300){
      var b = S.F.writeBatch(S.fs);
      all.slice(s, s + 300).forEach(function(x){
        if (x.t === 'set') b.set(S.F.doc(S.fs, 'catalog', x.o.code), x.o.d); else b.delete(S.F.doc(S.fs, 'catalog', x.id));
      });
      await b.commit();
    }
    ops.forEach(function(o){ hashes['p:' + o.code] = o.sig; }); saveHashes();
    if (manual) say(all.length ? 'تم نشر المنتجات (' + ops.length + ' محدّث، ' + stale.length + ' محذوف)' : 'المنتجات منشورة ولا يوجد جديد');
  }catch(e){ P.msg = errText(e); if (manual) uiAlert('تعذر نشر المنتجات: ' + errText(e)); }
  P.busy = false; render();
}

/* حفظ تلقائي: يُستدعى بعد كل save() */
window.portalAfterSave = function(){
  if (!isOwner()) return;
  clearTimeout(P.timer);
  P.timer = setTimeout(function(){ publishAll(false); }, 6000);
};

/* ---------- حسابات العملاء ---------- */
function genPw(){ var n = ''; for (var i = 0; i < 6; i++) n += Math.floor(Math.random() * 10); return n; }
async function makeAccount(name, reset){
  if (!isOwner()) return uiAlert('سجّل الدخول أولاً بحساب صاحب البرنامج');
  var c = accountFor(name); var ph = FB.normPhone(phoneOf(c));
  if (!ph) return uiAlert('رقم موبايل ' + name + ' غير صحيح. عدّله من صفحة العملاء أولاً (11 رقماً يبدأ بـ 01).');
  var acc = portalDb().accounts, rec = acc[ph];
  if (rec && !reset) return shareCred(name, ph, rec.pw);
  if (reset && !(await uiConfirm('سيُنشأ للعميل ' + name + ' كلمة مرور جديدة، وتتوقف كلمة المرور القديمة. متابعة؟'))) return;
  var pw = genPw(), ver = reset && rec ? (rec.ver || 0) + 1 : 0, uid = null, sec = null;
  try{
    sec = S.A.initializeApp(FB.config, 'creator' + Date.now());
    var sauth = S.U.getAuth(sec);
    for (var t = 0; t < 8; t++){
      try{ var cr = await S.U.createUserWithEmailAndPassword(sauth, FB.emailFor(ph, ver), pw); uid = cr.user.uid; break; }
      catch(e){ if (e && e.code === 'auth/email-already-in-use'){ ver++; continue; } throw e; }
    }
    if (!uid) throw new Error('تعذر إنشاء الحساب');
    try{ await S.U.signOut(sauth); }catch(e){}
    try{ await S.A.deleteApp(sec); }catch(e){}
    acc[ph] = { uid:uid, pw:pw, ver:ver, at:today(), name:name };
    var d = custData(c); d.phone = ph; d.uid = uid; d.upd = new Date().toISOString();
    await S.F.setDoc(S.F.doc(S.fs, 'customers', ph), d);
    hashes['c:' + ph] = JSON.stringify(Object.assign({}, d, { upd:undefined })); saveHashes();
    save(); render();
    shareCred(name, ph, pw);
  }catch(e){
    try{ if (sec) await S.A.deleteApp(sec); }catch(x){}
    uiAlert('تعذر إنشاء الحساب: ' + errText(e));
  }
}
function portalUrl(){ return location.origin + '/customer.html'; }
async function shareCred(name, ph, pw){
  if (!pw){
    var m2 = 'أهلاً ' + name + '\nتم تفعيل حسابك ✓\nادخل من الرابط:\n' + portalUrl() + '\nبرقم موبايلك وكلمة المرور التي اخترتها عند التسجيل.\n\nترى كشف حسابك ونقاطك وتطلب منتجاتك.';
    if (await uiConfirm('حساب ' + name + ' سجّله العميل بنفسه (كلمة مروره لا نعرفها).\nإرسال رابط الدخول له عبر واتساب؟')){
      openExternal('https://wa.me/' + ((typeof waNumber === 'function') ? waNumber(ph) : ph) + '?text=' + encodeURIComponent(m2));
    }
    return;
  }
  var msg = 'أهلاً ' + name + '\nرابط حسابك ومتجرنا:\n' + portalUrl() + '\n\nرقم الموبايل: ' + ph + '\nكلمة المرور: ' + pw + '\n\nمن خلاله ترى كشف حسابك ونقاطك وتطلب منتجاتك.';
  if (await uiConfirm('بيانات دخول ' + name + ':\nالموبايل: ' + ph + '\nكلمة المرور: ' + pw + '\n\nإرسالها للعميل عبر واتساب؟')){
    var num = (typeof waNumber === 'function') ? waNumber(ph) : ph;
    openExternal('https://wa.me/' + num + '?text=' + encodeURIComponent(msg));
  }
}

/* ---------- الطلبات والإشعارات ---------- */
function tsMs(o){ var t = o && o.createdAt; return t && t.toMillis ? t.toMillis() : (t && t.seconds ? t.seconds * 1000 : 0); }
function startOrders(){
  var q = S.F.query(S.F.collection(S.fs, 'orders'), S.F.orderBy('createdAt', 'desc'), S.F.limit(80));
  P.unsub = S.F.onSnapshot(q, function(snap){
    var list = []; snap.forEach(function(d){ var o = d.data(); o.id = d.id; list.push(o); });
    var seen = +localStorage.getItem(SEEN_KEY) || 0, fresh = [];
    if (P.first){ fresh = list.filter(function(o){ return o.status === 'new' && tsMs(o) > seen; }); }
    else { snap.docChanges().forEach(function(ch){ if (ch.type === 'added'){ var o = ch.doc.data(); o.id = ch.doc.id; fresh.push(o); } }); }
    P.first = false; P.orders = list;
    if (fresh.length) notifyOrders(fresh);
    render(); updateBadge();
  }, function(e){ P.msg = errText(e); render(); });
  P.unsub2 = S.F.onSnapshot(S.F.collection(S.fs, 'signups'), function(snap){
    var list = []; snap.forEach(function(d){ var o = d.data(); o.uid = d.id; list.push(o); });
    var added = []; if (!P.f2) snap.docChanges().forEach(function(ch){ if (ch.type === 'added' && ch.doc.data().status === 'pending') added.push(ch.doc.data()); });
    P.f2 = false; P.signups = list.sort(function(a,b){ return tsMs(b) - tsMs(a); });
    if (added.length) alertOwner('طلب تسجيل جديد', added.map(function(x){ return x.name + ' ' + x.phone; }).join('، '));
    render(); updateBadge();
  }, function(){});
  P.unsub3 = S.F.onSnapshot(S.F.collection(S.fs, 'resets'), function(snap){
    var list = []; snap.forEach(function(d){ var o = d.data(); o.id = d.id; list.push(o); });
    var added = []; if (!P.f3) snap.docChanges().forEach(function(ch){ if (ch.type === 'added') added.push(ch.doc.data()); });
    P.f3 = false; P.resets = list.sort(function(a,b){ return (b.at || 0) - (a.at || 0); });
    if (added.length) alertOwner('طلب كلمة مرور جديدة', added.map(function(x){ return x.phone; }).join('، '));
    render(); updateBadge();
  }, function(){});
}
function alertOwner(title, body){
  say(title); beep();
  try{
    if ('Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker && navigator.serviceWorker.getRegistration){
      navigator.serviceWorker.getRegistration().then(function(r){ if (r && r.showNotification) r.showNotification(title, { body:body, icon:'icon-192.png', badge:'icon-192.png', tag:'hisab-req', renotify:true, dir:'rtl', lang:'ar', vibrate:[200,100,200] }); });
    }
  }catch(e){}
}
function notifyOrders(fresh){
  var mx = fresh.reduce(function(m,o){ return Math.max(m, tsMs(o)); }, +localStorage.getItem(SEEN_KEY) || 0);
  try{ localStorage.setItem(SEEN_KEY, String(mx)); }catch(e){}
  var o = fresh[0];
  var title = fresh.length > 1 ? fresh.length + ' طلبات جديدة من المتجر/الخدمات' : 'طلب متجر أو خدمة من ' + (o.name || 'عميل');
  var body = fresh.length > 1 ? 'افتح إدارة العملاء لمراجعة الطلبات' : (o.phone || '') + ' — ' + (o.items || []).map(function(i){ return i.n + ' × ' + i.q; }).join('، ') + ' — ' + money(o.total) + ' ج' + (o.note ? ' — ' + o.note : '');
  say(title); beep();
  try{
    if ('Notification' in window && Notification.permission === 'granted'){
      var opt = { body:body, icon:'icon-192.png', badge:'icon-192.png', tag:'hisab-order', renotify:true, dir:'rtl', lang:'ar', vibrate:[200,100,200] };
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration){
        navigator.serviceWorker.getRegistration().then(function(r){ if (r && r.showNotification) r.showNotification(title, opt); else new Notification(title, opt); });
      } else new Notification(title, opt);
    }
  }catch(e){}
}
function beep(){
  try{
    var A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    var c = new A(), o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = 880; o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.3, c.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6);
    o.start(); o.stop(c.currentTime + 0.65);
  }catch(e){}
}
function updateBadge(){
  var n = P.orders.filter(function(o){ return o.status === 'new'; }).length + P.signups.filter(function(x){ return x.status === 'pending'; }).length + P.resets.length;
  var b = el('pt-badge'); if (b){ b.textContent = n ? String(n) : ''; b.style.display = n ? 'inline-block' : 'none'; }
}
async function enableNotif(){
  if (!('Notification' in window)) return uiAlert('هذا المتصفح لا يدعم الإشعارات');
  try{ var r = await Notification.requestPermission(); say(r === 'granted' ? 'تم تفعيل الإشعارات' : 'لم يُسمح بالإشعارات'); }catch(e){}
  render();
}
async function setStatus(id, st){
  try{ await S.F.updateDoc(S.F.doc(S.fs, 'orders', id), { status:st, statusUpdatedAt:S.F.serverTimestamp() }); }catch(e){ uiAlert('تعذر التحديث: ' + errText(e)); }
}
async function bookOrder(id){
  var o = P.orders.filter(function(x){ return x.id === id; })[0]; if (!o) return;
  var c = db.customers.filter(function(c){ return FB.normPhone(phoneOf(c)) === o.phone; })[0] || accountFor(o.name);
  if (!c) return uiAlert('لم أجد العميل في البرنامج');
  if (!(await uiConfirm('تسجيل طلب ' + c.name + ' (' + o.items.length + ' صنف) كعمليات على حسابه بتاريخ اليوم؟'))) return;
  var prods = {}; getProducts().forEach(function(p){ prods[p.name] = p; });
  var date = today(), acct = (typeof ACCTS !== 'undefined' && ACCTS[0]) || '';
  o.items.forEach(function(i){
    var p = prods[i.n], q = +i.q || 1;
    db.ops.push({ id:nid(), month:MONTHS[new Date(date).getMonth()], date:date, name:c.name, desc:q > 1 ? i.n + ' × ' + q : i.n,
                  cost:r2((p ? p.cost : 0) * q), price:r2(i.p * q), acct:acct, kind:'op' });
  });
  save(); refresh();
  await S.F.updateDoc(S.F.doc(S.fs, 'orders', id), { status:'done', booked:true });
  say('تم تسجيل الطلب كعمليات');
}

/* ---------- طلبات التسجيل وكلمات المرور ---------- */
function byPhone(ph){ return db.customers.filter(function(c){ return FB.normPhone(phoneOf(c)) === ph; })[0]; }
async function approveSignup(uid){
  var sg = P.signups.filter(function(x){ return x.uid === uid; })[0]; if (!sg) return;
  var ph = sg.phone, c = byPhone(ph);
  if (!c){
    if (!(await uiConfirm('لا يوجد عميل برقم ' + ph + ' في البرنامج.\nهل تضيفه كعميل جديد باسم «' + sg.name + '»؟'))) return;
    var nm = db.customers.some(function(x){ return x.name === sg.name; }) ? sg.name + ' (' + ph + ')' : sg.name;
    c = { name:nm, phone:ph, prev:0, verified:null, excluded:false }; db.customers.push(c); save();
  } else if (!(await uiConfirm('تفعيل حساب «' + c.name + '» برقم ' + ph + '؟\nالاسم الذي كتبه العميل: ' + sg.name + '\nتأكد أن الرقم رقمه فعلاً قبل التفعيل، لأنه سيرى كشف الحساب.'))) return;
  try{
    var d = custData(c); d.phone = ph; d.uid = uid; d.upd = new Date().toISOString();
    await S.F.setDoc(S.F.doc(S.fs, 'customers', ph), d);
    portalDb().accounts[ph] = { uid:uid, pw:'', ver:0, self:true, at:today(), name:c.name };
    hashes['c:' + ph] = JSON.stringify(Object.assign({}, d, { upd:undefined })); saveHashes(); save();
    await S.F.updateDoc(S.F.doc(S.fs, 'signups', uid), { status:'approved' });
    render(); say('تم تفعيل الحساب');
    shareCred(c.name, ph, '');
  }catch(e){ uiAlert('تعذر التفعيل: ' + errText(e)); }
}
async function rejectSignup(uid){
  if (!(await uiConfirm('رفض هذا الطلب؟'))) return;
  try{ await S.F.updateDoc(S.F.doc(S.fs, 'signups', uid), { status:'rejected' }); }catch(e){ uiAlert(errText(e)); }
}
async function handleReset(ph){
  var c = byPhone(ph);
  if (!c){
    if (await uiConfirm('لا يوجد عميل برقم ' + ph + ' في البرنامج. حذف الطلب؟')) try{ await S.F.deleteDoc(S.F.doc(S.fs, 'resets', ph)); }catch(e){}
    return;
  }
  var before = (portalDb().accounts[ph] || {}).uid;
  await makeAccount(c.name, true);
  if ((portalDb().accounts[ph] || {}).uid !== before){ try{ await S.F.deleteDoc(S.F.doc(S.fs, 'resets', ph)); }catch(e){} }
}
async function dropReset(ph){ try{ await S.F.deleteDoc(S.F.doc(S.fs, 'resets', ph)); }catch(e){ uiAlert(errText(e)); } }
function renderReq(){
  var box = el('pt-req-box'); if (!box) return;
  var sg = P.signups.filter(function(x){ return x.status === 'pending'; }), rs = P.resets;
  if (!sg.length && !rs.length){ box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = 'block';
  box.innerHTML = '<h3>طلبات تحتاج إجراءً <span class="owe">(' + (sg.length + rs.length) + ')</span></h3>' +
    sg.map(function(x){
      var known = byPhone(x.phone);
      return '<div class="box" style="background:#fff8e6;margin-top:8px"><b>تسجيل جديد: ' + h(x.name) + '</b><div class="muted" style="direction:ltr;text-align:right">' + h(x.phone) + '</div>' +
        '<div class="muted">' + (known ? 'عميل مسجّل: ' + h(known.name) : '<span class="owe">لا يوجد عميل بهذا الرقم</span>') + '</div>' +
        '<div style="margin-top:6px"><button onclick="portalApprove(\'' + x.uid + '\')">تفعيل</button> <button class="del" onclick="portalReject(\'' + x.uid + '\')">رفض</button></div></div>';
    }).join('') +
    rs.map(function(x){
      var known = byPhone(x.phone);
      return '<div class="box" style="background:#eef5ff;margin-top:8px"><b>نسيت كلمة السر</b><div class="muted" style="direction:ltr;text-align:right">' + h(x.phone) + '</div>' +
        '<div class="muted">' + (known ? 'العميل: ' + h(known.name) : '<span class="owe">لا يوجد عميل بهذا الرقم</span>') + '</div>' +
        '<div style="margin-top:6px"><button onclick="portalReset(\'' + x.phone + '\')">إنشاء كلمة مرور جديدة وإرسالها</button> <button class="del" onclick="portalDropReset(\'' + x.phone + '\')">تجاهل</button></div></div>';
    }).join('');
}

/* ---------- الواجهة ---------- */
var STL = { 'new':'جديد', 'prep':'قيد التجهيز', 'done':'تم التسليم', 'cancel':'ملغي' };
function render(){
  var a = el('pt-auth'), m = el('pt-main'); if (!a || !m) return;
  if (!isOwner()){
    m.style.display = 'none';
    a.innerHTML = '<h3>بوابة العملاء</h3><p class="muted">تتيح للعميل أن يرى كشف حسابه ونقاطه ويطلب من المتجر، وتصلك طلباته هنا مع إشعار.</p>' +
      '<label>كلمة مرور صاحب البرنامج</label><input id="pt-pw" type="password" autocomplete="current-password" placeholder="كلمة المرور" onkeydown="if(event.key===\'Enter\')portalLogin()">' +
      '<button onclick="portalLogin()" style="margin-top:8px">دخول</button>' +
      (P.msg ? '<p class="owe" style="margin-top:8px">' + h(P.msg) + '</p>' : '') +
      '<p class="muted" style="margin-top:8px">الحساب: ' + h(FB.ownerEmail) + '</p>';
    return;
  }
  a.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><b>بوابة العملاء — مفعّلة ✓</b><button class="del" onclick="portalLogout()">خروج</button></div>' +
    '<p class="muted">رابط العملاء: <b style="direction:ltr;display:inline-block">' + h(portalUrl()) + '</b> <button onclick="portalCopyLink()">نسخ</button></p>' +
    (P.msg ? '<p class="owe">' + h(P.msg) + '</p>' : '');
  m.style.display = 'block';
  renderReq();
  var perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  var ob = el('pt-orders-box');
  if (ob){
    var n = P.orders.filter(function(o){ return o.status === 'new'; }).length;
    ob.innerHTML = '<h3>طلبات العملاء ' + (n ? '<span class="owe">(' + n + ' جديد)</span>' : '') + '</h3>' +
      (perm === 'granted' ? '<p class="muted">الإشعارات مفعّلة. تصلك الطلبات الجديدة عندما يكون البرنامج مفتوحًا أو يعمل في الخلفية. أما وصولها بعد إغلاقه تمامًا فيحتاج إعداد إشعارات دفع Firebase على الخادم.</p>'
        : (perm === 'unsupported' ? '' : '<button onclick="portalNotif()">🔔 تفعيل الإشعارات</button>')) +
      (P.orders.length ? P.orders.slice(0, 40).map(orderCard).join('') : '<p class="muted">لا توجد طلبات بعد.</p>');
  }
  var st = el('pt-status');
  if (st) st.textContent = (P.pubAt ? 'آخر نشر: ' + P.pubAt + ' — ' : '') + 'يُنشر كشف الحساب تلقائياً بعد كل تغيير.';
  renderCusts();
}
function orderCard(o){
  var t = tsMs(o); var when = t ? new Date(t).toLocaleString('ar-EG') : '';
  var items = (o.items || []).map(function(i){ return '<div>' + h(i.n) + ' × ' + i.q + ' = ' + money(r2(i.p * i.q)) + '</div>'; }).join('');
  var bg = o.status === 'new' ? '#fff8e6' : (o.status === 'cancel' ? '#fdecec' : '#f4faf5');
  var btns = '';
  if (o.status === 'new') btns += '<button onclick="portalStatus(\'' + o.id + '\',\'prep\')">قيد التجهيز</button> ';
  if (o.status === 'new' || o.status === 'prep'){ btns += '<button onclick="portalStatus(\'' + o.id + '\',\'done\')">تم التسليم</button> <button class="del" onclick="portalStatus(\'' + o.id + '\',\'cancel\')">إلغاء</button> '; }
  if (o.status !== 'cancel' && !o.booked) btns += '<button onclick="portalBook(\'' + o.id + '\')">تسجيل كعمليات</button>';
  var ph = FB.normPhone(o.phone), wa = ph && (typeof waNumber === 'function') ? '<a href="https://wa.me/' + waNumber(ph) + '" target="_blank" rel="noopener">واتساب ' + h(ph) + '</a>' : h(o.phone || '');
  return '<div class="box" style="background:' + bg + ';margin-top:8px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + h(o.name) + '</b><span class="muted">' + h(when) + '</span></div>' +
    '<div class="muted">' + wa + ' — <b>' + (STL[o.status] || o.status) + '</b>' + (o.booked ? ' ✓ مسجّل' : '') + '</div>' + items +
    '<div><b>الإجمالي: ' + money(o.total) + ' ج</b></div>' + (o.note ? '<div class="muted">ملاحظة: ' + h(o.note) + '</div>' : '') + '<div style="margin-top:6px">' + btns + '</div></div>';
}
function renderCusts(){
  var box = el('pt-custs'); if (!box) return;
  var q = ((el('pt-q') || {}).value || '').trim();
  var acc = portalDb().accounts;
  var list = db.customers.filter(function(c){ return !c.excluded && (!q || c.name.indexOf(q) >= 0 || String(phoneOf(c) || '').indexOf(q) >= 0); })
                         .sort(function(a,b){ return a.name.localeCompare(b.name, 'ar'); });
  box.innerHTML = '<p class="muted">' + Object.keys(acc).length + ' حساب مفعّل من ' + db.customers.filter(function(c){ return !c.excluded; }).length + ' عميل</p>' +
    '<table><tr><th>العميل</th><th>الموبايل</th><th>الحساب</th></tr>' + list.map(function(c){
      var ph = FB.normPhone(phoneOf(c)), rec = ph && acc[ph], nm = JSON.stringify(c.name).replace(/"/g, '&quot;');
      var act = !ph ? '<span class="owe">رقم غير صحيح</span>' : (rec
        ? '<button onclick="portalMake(' + nm + ',false)">إرسال البيانات</button> <button class="del" onclick="portalMake(' + nm + ',true)">كلمة مرور جديدة</button>'
        : '<button onclick="portalMake(' + nm + ',false)">إنشاء حساب</button>');
      return '<tr><td class="r">' + h(c.name) + '</td><td style="direction:ltr">' + h(ph || phoneOf(c) || '—') + '</td><td>' + act + '</td></tr>';
    }).join('') + '</table>';
}

/* ---------- واجهة عامة للأزرار ---------- */
window.portalLogin = login; window.portalLogout = logout; window.portalNotif = enableNotif;
window.portalPublishAll = function(m){ return publishAll(m !== false); };
window.portalPublishCatalog = function(m){ return publishCatalog(m !== false); };
window.portalMake = function(n, r){ return makeAccount(n, r); };
window.portalApprove = approveSignup; window.portalReject = rejectSignup; window.portalReset = handleReset; window.portalDropReset = dropReset;
window.portalStatus = setStatus; window.portalBook = bookOrder; window.portalRender = renderCusts;
window.portalCopyLink = function(){ try{ navigator.clipboard.writeText(portalUrl()); say('تم نسخ الرابط'); }catch(e){ uiAlert(portalUrl()); } };
window.portalOpen = function(){ sdk().then(render).catch(function(e){ P.msg = errText(e); render(); }); };

/* يبدأ تلقائياً: إن كان الدخول محفوظاً يعود دون طلب كلمة المرور */
window.addEventListener('load', function(){ sdk().then(function(){ render(); }).catch(function(e){ P.msg = errText(e); render(); }); });
})();

/* إعدادات Firebase المشتركة بين برنامج الإدارة وصفحة العملاء */
window.HISAB_FB = {
  config: {
    apiKey: "AIzaSyBc64emNPCP-G9HJBqf6NXy2pHcaldMF-E",
    authDomain: "hisab-customers.firebaseapp.com",
    projectId: "hisab-customers",
    storageBucket: "hisab-customers.firebasestorage.app",
    messagingSenderId: "816814958398",
    appId: "1:816814958398:web:180adce410eb616e15ee6f"
  },
  sdk: "https://www.gstatic.com/firebasejs/10.14.1/",
  ownerEmail: "owner@hisab-customers.com",   // حساب صاحب البرنامج (يُنشأ يدوياً في Firebase Authentication)
  ntfy: "",                                  // اختياري: اسم قناة ntfy.sh لوصول إشعار حتى والبرنامج مغلق
  // رقم الموبايل → بريد داخلي لا يراه العميل
  emailFor: function(ph, ver){ return (ver ? ph + "." + ver : ph) + "@hisab-customers.com"; },
  normPhone: function(p){
    var s = String(p == null ? "" : p).replace(/[\u0660-\u0669]/g, function(d){ return d.charCodeAt(0) - 1632; })
                                      .replace(/[\u06F0-\u06F9]/g, function(d){ return d.charCodeAt(0) - 1776; })
                                      .replace(/\D/g, "");
    if (s.indexOf("0020") === 0) s = "0" + s.slice(4);
    else if (s.indexOf("20") === 0 && s.length === 12) s = "0" + s.slice(2);
    else if (s.length === 10 && s.charAt(0) === "1") s = "0" + s;
    return /^01\d{9}$/.test(s) ? s : "";
  }
};

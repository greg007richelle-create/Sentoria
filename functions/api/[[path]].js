const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const bad=(message,status=400)=>json({error:message},status);
const encode=v=>new TextEncoder().encode(v);
async function sha(s){const b=await crypto.subtle.digest('SHA-256',encode(s));return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('')}
function timingSafe(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
function randomToken(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
function cookie(req,name){return (req.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||''}
function csrf(req,env){const o=req.headers.get('Origin');if(!o)return false;try{return new URL(o).origin===new URL(env.SITE_URL).origin}catch{return false}}
async function body(req){if(Number(req.headers.get('content-length')||0)>12000)throw Error('Payload trop grand');const raw=await req.text();if(raw.length>12000)throw Error('Payload trop grand');return JSON.parse(raw)}
async function admin(req,env){const t=cookie(req,'sentoria_admin');if(!/^[0-9a-f]{64}$/.test(t))return false;const h=await sha(t);const row=await env.DB.prepare('SELECT email FROM sessions WHERE token_hash=? AND expires>?').bind(h,Date.now()).first();return row?.email===env.ADMIN_EMAIL}
async function email(env,to,subject,html){if(!env.RESEND_API_KEY||!env.MAIL_FROM)throw Error('Email non configuré');const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.MAIL_FROM,to:[to],subject,html})});if(!r.ok)throw Error('Service email indisponible')}
function escape(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function limit(env,key,max,windowMs){const now=Date.now(),k=await sha(key);const row=await env.DB.prepare('SELECT count,start_at FROM auth_limits WHERE key=?').bind(k).first();if(!row||now-row.start_at>windowMs){await env.DB.prepare('INSERT INTO auth_limits(key,count,start_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=1,start_at=excluded.start_at').bind(k,now).run();return true}if(row.count>=max)return false;await env.DB.prepare('UPDATE auth_limits SET count=count+1 WHERE key=?').bind(k).run();return true}
async function stripe(path,env,params){const r=await fetch('https://api.stripe.com/v1/'+path,{method:'POST',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});const data=await r.json();if(!r.ok)throw Error(data.error?.message||'Stripe indisponible');return data}
async function verifyStripe(req,secret){const raw=await req.text(),header=req.headers.get('stripe-signature')||'';const t=/\bt=(\d+)/.exec(header)?.[1];const signatures=[...header.matchAll(/\bv1=([a-f0-9]+)/g)].map(m=>m[1]);if(!t||!signatures.length||Math.abs(Date.now()/1000-Number(t))>300)return null;const key=await crypto.subtle.importKey('raw',encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encode(t+'.'+raw))),b=>b.toString(16).padStart(2,'0')).join('');if(!signatures.some(s=>timingSafe(s,signature)))return null;return JSON.parse(raw)}
function getPath(url){return new URL(url).pathname.replace(/^\/api\/?/,'')}
export async function onRequest({request:req,env}){
 const path=getPath(req.url),method=req.method;
 try{
 if(!env.DB)return bad('Base D1 non configurée',503);
 if(path==='catalog'&&method==='GET'){const r=await env.DB.prepare('SELECT id,name,subtitle,description,price_cents,stock,scent,burn_time,color,featured,active FROM products WHERE active=1').all();return json({products:r.results,settings:{shippingHome:Number(env.SHIPPING_HOME_CENTS||650),shippingPickup:Number(env.SHIPPING_PICKUP_CENTS||350),store:env.STORE_ENABLED==='true'&&env.PAYMENTS_ENABLED==='true'}})}
 if(path==='stripe-webhook'&&method==='POST'){
  if(!env.STRIPE_WEBHOOK_SECRET)return bad('Non configuré',503);const event=await verifyStripe(req,env.STRIPE_WEBHOOK_SECRET);if(!event)return bad('Signature invalide',400);
  if(event.type==='checkout.session.completed'&&event.data.object.payment_status==='paid'){
   const sess=event.data.object,orderId=sess.metadata?.order_id;if(!orderId)return json({ok:true});
   const order=await env.DB.prepare('SELECT * FROM orders WHERE id=? AND stripe_session_id=?').bind(orderId,sess.id).first();if(!order||order.total_cents!==sess.amount_total||sess.currency!=='eur')return bad('Transaction incohérente',400);
   if(order.status==='pending'){
    const items=JSON.parse(order.items_json);const ops=[];for(const it of items)ops.push(env.DB.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').bind(it.qty,it.id,it.qty));
    // Un contrôle préalable est effectué ; le stock est réévalué à la confirmation.
    const stocks=await Promise.all(items.map(it=>env.DB.prepare('SELECT stock FROM products WHERE id=?').bind(it.id).first()));
    const enough=stocks.every((s,i)=>s&&s.stock>=items[i].qty);const status=enough?'paid':'manual_review';
    const result=await env.DB.prepare("UPDATE orders SET status=?,paid_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(status,order.id).run();
    if(result.meta.changes){if(enough)await env.DB.batch(ops);const lines=items.map(it=>`${escape(it.name)} × ${it.qty} — ${((it.price_cents*it.qty)/100).toFixed(2)} €`).join('<br>');
      const legal='Votre commande est enregistrée. Vous bénéficiez en principe d’un droit de rétractation de 14 jours après réception, selon les exceptions légales. Consultez les CGV et le formulaire de rétractation sur notre site.';
      try{await email(env,order.customer_email,'Sentoria · confirmation de commande '+order.id,`<h2>Merci pour votre commande</h2><p>Référence : ${escape(order.id)}</p><p>${lines}</p><p>Livraison : ${escape(order.shipping)} — ${escape(order.address)}, ${escape(order.postal)} ${escape(order.city)}</p><p>Total payé : ${(order.total_cents/100).toFixed(2)} €</p><p>${legal}</p><p>Service client : ${escape(env.CONTACT_EMAIL||env.ADMIN_EMAIL||'à compléter')}</p>`)}catch(e){console.error('customer email failed',e.message)}
      try{await email(env,env.ADMIN_EMAIL,`Nouvelle commande Sentoria ${order.id} (${status})`,`<h2>Commande ${escape(order.id)}</h2><p>${escape(order.customer_name)} — ${escape(order.customer_email)}</p><p>${lines}</p><p>Livraison : ${escape(order.address)} ${escape(order.postal)} ${escape(order.city)} (${escape(order.shipping)})</p><p>Statut : ${status}</p><p>Montant : ${(order.total_cents/100).toFixed(2)} €</p>`)}catch(e){console.error('admin email failed',e.message)}
    }
   }
  }
  return json({ok:true});
 }
 if(method==='POST'&&!csrf(req,env))return bad('Origine non autorisée',403);
 if(path==='event'&&method==='POST'){const d=await body(req);if(!['visit','add_cart','cart_view','checkout_start'].includes(d.kind)||typeof d.visitor!=='string'||!/^[a-f0-9-]{36}$/.test(d.visitor))return bad('Événement invalide');const id=await sha(d.kind+':'+d.visitor);await env.DB.prepare('INSERT OR IGNORE INTO events(id,kind,visitor) VALUES(?,?,?)').bind(id,d.kind,await sha(d.visitor)).run();return json({ok:true})}
 if(path==='checkout'&&method==='POST'){
  if(env.STORE_ENABLED!=='true'||env.PAYMENTS_ENABLED!=='true'||!env.STRIPE_SECRET_KEY)return bad('Boutique en préparation. Paiements non activés.',503);
  const d=await body(req);if(!d||typeof d!=='object'||!Array.isArray(d.items)||d.items.length<1||d.items.length>12)return bad('Panier invalide');
  for(const f of ['name','email','address','postal','city'])if(typeof d[f]!=='string'||!d[f].trim())return bad('Coordonnées incomplètes');
  if(d.name.length>100||d.address.length>200||d.city.length>100||!/^\d{4}$/.test(d.postal)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)||d.email.length>254||!['home','pickup'].includes(d.shipping))return bad('Coordonnées invalides');
  if(d.phone&&String(d.phone).length>32)return bad('Téléphone invalide');
  const ids=new Set(),items=[];for(const it of d.items){if(typeof it.id!=='string'||!/^[a-z0-9-]{1,40}$/.test(it.id)||!Number.isInteger(it.qty)||it.qty<1||it.qty>10||ids.has(it.id))return bad('Panier invalide');ids.add(it.id);const p=await env.DB.prepare('SELECT * FROM products WHERE id=? AND active=1').bind(it.id).first();if(!p||p.stock<it.qty)return bad('Un article est épuisé');items.push({id:p.id,name:p.name,qty:it.qty,price_cents:p.price_cents})}
  const ship=d.shipping==='home'?Number(env.SHIPPING_HOME_CENTS):Number(env.SHIPPING_PICKUP_CENTS);if(!Number.isSafeInteger(ship)||ship<0)return bad('Livraison non configurée',503);
  const total=items.reduce((n,it)=>n+it.price_cents*it.qty,ship);if(total<50||total>1000000)return bad('Total invalide');
  const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO orders(id,customer_email,customer_name,phone,address,postal,city,shipping,shipping_cents,total_cents,items_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,d.email.trim().toLowerCase(),d.name.trim(),d.phone||'',d.address.trim(),d.postal,d.city.trim(),d.shipping,ship,total,JSON.stringify(items)).run();
  const base=env.SITE_URL.replace(/\/$/,'');const params={'mode':'payment','success_url':base+'/?payment=success','cancel_url':base+'/?payment=cancel','client_reference_id':id,'metadata[order_id]':id,'customer_email':d.email.trim().toLowerCase(),'billing_address_collection':'auto','locale':'fr'};
  items.forEach((it,i)=>{params[`line_items[${i}][price_data][currency]`]='eur';params[`line_items[${i}][price_data][product_data][name]`]=it.name;params[`line_items[${i}][price_data][unit_amount]`]=String(it.price_cents);params[`line_items[${i}][quantity]`]=String(it.qty)});
  const n=items.length;params[`line_items[${n}][price_data][currency]`]='eur';params[`line_items[${n}][price_data][product_data][name]`]=d.shipping==='home'?'Livraison à domicile — Belgique':'Livraison en point de retrait — Belgique';params[`line_items[${n}][price_data][unit_amount]`]=String(ship);params[`line_items[${n}][quantity]`]='1';
  try{const session=await stripe('checkout/sessions',env,params);await env.DB.prepare('UPDATE orders SET stripe_session_id=? WHERE id=?').bind(session.id,id).run();return json({url:session.url})}catch(e){await env.DB.prepare("UPDATE orders SET status='failed' WHERE id=?").bind(id).run();throw e}
 }
 if(path==='admin/request-code'&&method==='POST'){
  const d=await body(req),mail=typeof d.email==='string'?d.email.trim().toLowerCase():'';const remote=req.headers.get('CF-Connecting-IP')||'unknown';const okay=await limit(env,'otp-ip:'+remote,6,3600000);if(!okay)return bad('Trop de tentatives, réessayez plus tard.',429);
  if(env.ADMIN_EMAIL&&env.ADMIN_OTP_SECRET&&mail===env.ADMIN_EMAIL.toLowerCase()&&await limit(env,'otp-mail:'+mail,3,900000)){
   const otp=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');const h=await sha(mail+':'+otp+':'+env.ADMIN_OTP_SECRET);await env.DB.prepare('INSERT INTO otp(email,hash,expires,attempts,sent_at) VALUES(?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET hash=excluded.hash,expires=excluded.expires,attempts=0,sent_at=excluded.sent_at').bind(mail,h,Date.now()+600000,Date.now()).run();try{await email(env,mail,'Sentoria · votre code de connexion',`<p>Code de connexion : <strong>${otp}</strong></p><p>Valide 10 minutes. Si vous n'êtes pas à l'origine de la demande, ignorez cet e-mail.</p>`)}catch(e){console.error('OTP send failure',e.message)}
  }return json({ok:true,message:'Si cette adresse est autorisée, un code a été envoyé.'})
 }
 if(path==='admin/verify-code'&&method==='POST'){
  const d=await body(req),mail=typeof d.email==='string'?d.email.trim().toLowerCase():'',code=String(d.code||'');if(!/^\d{6}$/.test(code))return bad('Code invalide');const remote=req.headers.get('CF-Connecting-IP')||'unknown';if(!await limit(env,'verify-ip:'+remote,12,900000))return bad('Trop de tentatives',429);
  if(mail!==env.ADMIN_EMAIL?.toLowerCase())return bad('Code invalide',401);const row=await env.DB.prepare('SELECT * FROM otp WHERE email=?').bind(mail).first();if(!row||row.expires<Date.now()||row.attempts>=5)return bad('Code expiré ou invalide',401);
  await env.DB.prepare('UPDATE otp SET attempts=attempts+1 WHERE email=?').bind(mail).run();const h=await sha(mail+':'+code+':'+env.ADMIN_OTP_SECRET);if(!timingSafe(h,row.hash))return bad('Code expiré ou invalide',401);
  await env.DB.prepare('DELETE FROM otp WHERE email=?').bind(mail).run();const token=randomToken(),hash=await sha(token);await env.DB.prepare('INSERT INTO sessions(token_hash,email,expires) VALUES(?,?,?)').bind(hash,mail,Date.now()+8*3600000).run();return json({ok:true},200,{'Set-Cookie':`sentoria_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=28800`})
 }
 if(path==='admin/me'&&method==='GET')return json({authenticated:await admin(req,env)});
 if(path==='admin/logout'&&method==='POST'){const t=cookie(req,'sentoria_admin');if(t)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(t)).run();return json({ok:true},200,{'Set-Cookie':'sentoria_admin=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0'})}
 if(path.startsWith('admin/')&&!(await admin(req,env)))return bad('Accès interdit',401);
 if(path==='admin/dashboard'&&method==='GET'){
  const orders=await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all();const products=await env.DB.prepare('SELECT * FROM products ORDER BY featured DESC,name').all();const e=await env.DB.prepare('SELECT kind,COUNT(*) n FROM events GROUP BY kind').all();const paid=await env.DB.prepare("SELECT COUNT(*) n,COALESCE(SUM(total_cents),0) total FROM orders WHERE status IN ('paid','fulfilled','manual_review')").first();return json({orders:orders.results,products:products.results,events:e.results,paid})
 }
 if(path==='admin/product'&&method==='POST'){const d=await body(req);if(!/^[a-z0-9-]{1,40}$/.test(d.id)||!Number.isInteger(d.price_cents)||d.price_cents<0||d.price_cents>100000||!Number.isInteger(d.stock)||d.stock<0||d.stock>999||typeof d.name!=='string'||d.name.length>100)return bad('Article invalide');await env.DB.prepare('UPDATE products SET name=?,price_cents=?,stock=?,active=? WHERE id=?').bind(d.name.trim(),d.price_cents,d.stock,d.active?1:0,d.id).run();return json({ok:true})}
 if(path==='admin/order-status'&&method==='POST'){const d=await body(req);if(typeof d.id!=='string'||!['paid','fulfilled','manual_review','refunded','cancelled'].includes(d.status))return bad('Statut invalide');await env.DB.prepare("UPDATE orders SET status=? WHERE id=? AND status NOT IN ('pending','failed')").bind(d.status,d.id).run();return json({ok:true})}
 if(path==='withdrawal'&&method==='POST'){
  const d=await body(req);if(typeof d.order!=='string'||typeof d.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email))return bad('Données invalides');const r=await env.DB.prepare('UPDATE orders SET withdrawal_requested_at=COALESCE(withdrawal_requested_at,CURRENT_TIMESTAMP) WHERE id=? AND customer_email=? AND status NOT IN (\'pending\',\'failed\')').bind(d.order,d.email.trim().toLowerCase()).run();if(r.meta.changes&&env.ADMIN_EMAIL)try{await email(env,env.ADMIN_EMAIL,'Sentoria · demande de rétractation',`Demande pour la commande ${escape(d.order)} — ${escape(d.email)}`)}catch(e){console.error(e.message)}return json({ok:true,message:'Si la commande correspond, votre demande a été enregistrée. Contactez-nous également par e-mail si nécessaire.'})
 }
 return bad('Ressource introuvable',404)
 }catch(e){console.error('api error',e.message);return bad('Erreur serveur. Réessayez ou contactez Sentoria.',500)}
}

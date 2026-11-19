import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const PgSession = connectPgSimple(session);
const required = ['DATABASE_URL','SESSION_SECRET','BASE_URL','ADMIN_EMAIL','ADMIN_PASSWORD'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
if ((process.env.SESSION_SECRET || '').length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
if (process.env.SSL_MODE !== 'sandbox') throw new Error('This starter is sandbox-only. Live payment mode is intentionally disabled.');

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '20kb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const q = (sql, params=[]) => pool.query(sql, params);
const esc = (s) => String(s ?? '').slice(0, 190);
const authed = (req,res,next) => req.session.user ? next() : res.status(401).json({error:'লগইন প্রয়োজন'});
const admin = (req,res,next) => req.session.user?.role === 'admin' ? next() : res.status(403).json({error:'অ্যাডমিন অনুমতি প্রয়োজন'});

async function init() {
  await q(await (await import('node:fs/promises')).readFile(path.join(__dirname,'db.sql'),'utf8'));
  const email = process.env.ADMIN_EMAIL.toLowerCase();
  const found = await q('SELECT id FROM users WHERE email=$1',[email]);
  if (!found.rowCount) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await q("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')",['Smart Invest Admin',email,hash]);
  }
}
app.get('/api/health', (_req,res)=>res.json({ok:true,mode:'sandbox',walletCredit:false}));

app.post('/api/register', rateLimit({windowMs:60*60*1000,limit:8}), async (req,res)=>{
  try {
    const name=esc(req.body.name).trim(), email=esc(req.body.email).trim().toLowerCase(), password=String(req.body.password||'');
    if(name.length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<10) return res.status(400).json({error:'নাম, বৈধ ইমেইল এবং কমপক্ষে ১০ অক্ষরের পাসওয়ার্ড দিন'});
    const hash=await bcrypt.hash(password,12);
    const r=await q('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,role',[name,email,hash]);
    req.session.user=r.rows[0]; res.json({user:r.rows[0]});
  } catch(e) { res.status(400).json({error:'এই ইমেইল আগে ব্যবহৃত হয়ে থাকতে পারে'}); }
});
app.post('/api/login', rateLimit({windowMs:15*60*1000,limit:10}), async (req,res)=>{
  const email=esc(req.body.email).toLowerCase(), password=String(req.body.password||'');
  const r=await q('SELECT id,name,email,password_hash,role FROM users WHERE email=$1',[email]);
  if(!r.rowCount || !(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({error:'ইমেইল বা পাসওয়ার্ড সঠিক নয়'});
  const {password_hash,...user}=r.rows[0]; req.session.regenerate(err=>{if(err)return res.status(500).json({error:'Session error'});req.session.user=user;res.json({user});});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',authed,async(req,res)=>{
  const r=await q('SELECT id,name,email,role,created_at FROM users WHERE id=$1',[req.session.user.id]);
  const d=await q('SELECT id,tran_id,amount,currency,status,created_at FROM deposits WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[req.session.user.id]);
  res.json({user:r.rows[0],deposits:d.rows});
});

// Initiates a hosted SSLCOMMERZ sandbox checkout. Amount and user identity are server-controlled.
app.post('/api/deposits',authed,async(req,res)=>{
  try {
    if(!process.env.SSLCOMMERZ_STORE_ID || !process.env.SSLCOMMERZ_STORE_PASSWORD) return res.status(503).json({error:'Sandbox merchant credentials সেট করা হয়নি'});
    const amount=Number(req.body.amount);
    if(!Number.isFinite(amount) || amount<10 || amount>500000 || Math.round(amount*100)!==amount*100) return res.status(400).json({error:'পরিমাণ ১০ থেকে ৫০০,০০০ টাকা এবং সর্বোচ্চ ২ দশমিক হতে হবে'});
    const u=(await q('SELECT name,email FROM users WHERE id=$1',[req.session.user.id])).rows[0];
    const tranId='SID'+Date.now()+crypto.randomBytes(4).toString('hex').toUpperCase();
    await q("INSERT INTO deposits(user_id,tran_id,amount) VALUES($1,$2,$3)",[req.session.user.id,tranId,amount]);
    const base=process.env.BASE_URL.replace(/\/$/,'');
    const params=new URLSearchParams({
      store_id:process.env.SSLCOMMERZ_STORE_ID,store_passwd:process.env.SSLCOMMERZ_STORE_PASSWORD,
      total_amount:amount.toFixed(2),currency:'BDT',tran_id:tranId,
      success_url:base+'/api/payment/success',fail_url:base+'/api/payment/fail',cancel_url:base+'/api/payment/cancel',ipn_url:base+'/api/payment/ipn',
      cus_name:u.name,cus_email:u.email,cus_add1:'Bangladesh',cus_city:'Dhaka',cus_postcode:'1000',cus_country:'Bangladesh',cus_phone:'01700000000',
      shipping_method:'NO',num_of_item:'1',product_name:'Demo checkout',product_category:'service',product_profile:'non-physical-goods'
    });
    const response=await fetch('https://sandbox.sslcommerz.com/gwprocess/v4/api.php',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:params});
    const data=await response.json();
    if(data.status!=='SUCCESS' || !data.GatewayPageURL) {
      await q("UPDATE deposits SET status='gateway_error',gateway_payload=$1,updated_at=NOW() WHERE tran_id=$2",[data,tranId]);
      return res.status(502).json({error:'Gateway session তৈরি হয়নি',detail:data.failedreason||'Gateway error'});
    }
    await q('UPDATE deposits SET session_key=$1,gateway_payload=$2,updated_at=NOW() WHERE tran_id=$3',[data.sessionkey,data,tranId]);
    res.json({checkoutUrl:data.GatewayPageURL,transactionId:tranId,mode:'sandbox'});
  } catch(e) { console.error('deposit-init',e);res.status(500).json({error:'পেমেন্ট সেশন তৈরি করা যায়নি'}); }
});

async function verifyAndUpdate(payload) {
  const tranId=String(payload.tran_id||'');
  const local=await q('SELECT * FROM deposits WHERE tran_id=$1',[tranId]);
  if(!local.rowCount) throw new Error('Unknown transaction');
  const dep=local.rows[0];
  if(dep.status==='verified_sandbox') return;
  if(!payload.val_id) {
    const status=payload.status==='CANCELLED'?'cancelled':'failed';
    await q('UPDATE deposits SET status=$1,gateway_payload=$2,updated_at=NOW() WHERE tran_id=$3',[status,payload,tranId]);
    return;
  }
  const url=new URL('https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php');
  url.search=new URLSearchParams({val_id:String(payload.val_id),store_id:process.env.SSLCOMMERZ_STORE_ID,store_passwd:process.env.SSLCOMMERZ_STORE_PASSWORD,format:'json'});
  const vr=await fetch(url); const v=await vr.json();
  const amount=Number(v.amount);
  const good=['VALID','VALIDATED'].includes(v.status) && v.tran_id===tranId && v.currency==='BDT' && Math.abs(amount-Number(dep.amount))<0.005;
  const status=good && String(v.risk_level)==='0' ? 'verified_sandbox' : good ? 'review_required' : 'verification_failed';
  await q('UPDATE deposits SET status=$1,val_id=$2,risk_level=$3,gateway_payload=$4,updated_at=NOW() WHERE tran_id=$5',
    [status,String(payload.val_id),Number(v.risk_level||0),{callback:payload,validation:v},tranId]);
}
for (const route of ['success','fail','cancel']) {
  app.all('/api/payment/'+route,async(req,res)=>{
    try { await verifyAndUpdate({...req.body,...req.query}); res.redirect('/?payment='+route); }
    catch(e){console.error('callback',e);res.redirect('/?payment=check');}
  });
}
app.post('/api/payment/ipn',async(req,res)=>{
  try { await verifyAndUpdate(req.body); res.status(200).send('OK'); }
  catch(e){console.error('ipn',e);res.status(400).send('NOT_OK');}
});
app.get('/api/admin/deposits',authed,admin,async(req,res)=>{
  const r=await q(`SELECT d.id,d.tran_id,d.amount,d.currency,d.status,d.risk_level,d.created_at,u.name,u.email
    FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.created_at DESC LIMIT 200`);
  res.json({deposits:r.rows});
});
app.get('/api/admin/users',authed,admin,async(req,res)=>{
  const r=await q('SELECT id,name,email,role,created_at FROM users ORDER BY created_at DESC LIMIT 200');res.json({users:r.rows});
});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

const port=Number(process.env.PORT||3000);
init().then(()=>app.listen(port,()=>console.log(`Smart Invest sandbox backend on ${port}`))).catch(e=>{console.error(e);process.exit(1)});

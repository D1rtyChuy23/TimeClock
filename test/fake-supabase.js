// Stand-in for supabase-js used by run.py. Keeps its data in localStorage so reloads keep the "server" state.
// It follows the same rules as the real database: first sign-up is admin, employees only see their own rows,
// clock() never opens a second shift.
(()=>{
const LS="fake-backend";
const st=JSON.parse(localStorage.getItem(LS)||"null")||{users:[],profiles:[],punches:[],pto_requests:[],holidays:[],session:null,seq:1};
const cfg={fail:localStorage.getItem("fake-fail")==="1",confirmEmail:false,delay:30,calls:[]};
const save=()=>localStorage.setItem(LS,JSON.stringify(st));
const wait=()=>new Promise(r=>setTimeout(r,cfg.delay));
const NET={message:"Failed to fetch",status:0};
const listeners=[];
const emit=(evt)=>listeners.forEach(cb=>cb(evt,st.session));
const me=()=>st.session&&st.session.user.id;
const isAdmin=()=>st.profiles.some(p=>p.id===me()&&p.role==="admin");
const own={profiles:"id",punches:"user_id",pto_requests:"user_id"};
function query(table){
  const q={op:"select",filters:[],payload:null};
  const api={
    select(){return api},order(){return api},limit(){return api},
    gte(c,v){q.filters.push(r=>r[c]>=v);return api},
    eq(c,v){q.filters.push(r=>String(r[c])===String(v));return api},
    insert(p){q.op="insert";q.payload=p;return api},update(p){q.op="update";q.payload=p;return api},
    upsert(p){q.op="upsert";q.payload=p;return api},delete(){q.op="delete";return api},
    then(res,rej){return run().then(res,rej)}};
  async function run(){await wait();cfg.calls.push(table+"."+q.op);
    if(cfg.fail)return{data:null,error:NET};
    if(!me())return{data:null,error:{message:"permission denied",status:401}};
    const rows=st[table],admin=isAdmin(),mine=r=>!own[table]||admin||r[own[table]]===me(),match=r=>mine(r)&&q.filters.every(f=>f(r));
    if(q.op==="select")return{data:rows.filter(match).map(r=>({...r})),error:null};
    if(q.op==="insert"){
      if(table==="pto_requests")rows.push({id:st.seq++,user_id:me(),status:"pending",decided_by:null,...q.payload});
      else if(!admin)return{data:null,error:{message:"row-level security",status:403}};
      else rows.push({id:st.seq++,...q.payload});}
    else if(q.op==="upsert"){if(!admin)return{data:null,error:{message:"rls",status:403}};
      const i=rows.findIndex(r=>r.day===q.payload.day);if(i>=0)rows[i]=q.payload;else rows.push(q.payload)}
    else if(q.op==="update"){if(!admin&&table!=="profiles")return{data:null,error:null};
      rows.filter(match).forEach(r=>Object.assign(r,q.payload))}
    else if(q.op==="delete"){for(let i=rows.length-1;i>=0;i--){const r=rows[i];
      if(match(r)&&(admin||(table==="pto_requests"&&r.status==="pending")))rows.splice(i,1)}}
    save();return{data:null,error:null}}
  return api}
const sessionFor=u=>({user:{id:u.id,email:u.email}});
window.supabase={createClient(){return{
  from:query,
  async rpc(name,args){await wait();cfg.calls.push("rpc."+name+"."+(args.action||""));
    if(cfg.fail)return{data:null,error:NET};
    if(name!=="clock")return{data:null,error:{message:"no such function",status:404}};
    const uid=args.target||me();if(uid!==me()&&!isAdmin())return{data:null,error:{message:"Not allowed",status:400}};
    const open=st.punches.find(p=>p.user_id===uid&&!p.clock_out);let out;
    if(args.action==="in"){if(open)out="already_in";else{st.punches.push({id:st.seq++,user_id:uid,clock_in:new Date().toISOString(),clock_out:null,manual:false});out="in"}}
    else if(args.action==="out"){if(open){open.clock_out=new Date(Date.now()+1000).toISOString();out="out"}else out="already_out"}
    else return{data:null,error:{message:"action must be in or out",status:400}};
    save();return{data:out,error:null}},
  auth:{
    async getSession(){await wait();return{data:{session:st.session}}},
    onAuthStateChange(cb){listeners.push(cb);setTimeout(()=>cb("INITIAL_SESSION",st.session),5);return{data:{subscription:{unsubscribe(){}}}}},
    async signInWithPassword({email,password}){await wait();if(cfg.fail)return{data:{},error:NET};
      const u=st.users.find(u=>u.email===email&&u.password===password);
      if(!u)return{data:{},error:{status:400,code:"invalid_credentials",message:"Invalid login credentials"}};
      if(!u.confirmed)return{data:{},error:{status:400,code:"email_not_confirmed",message:"Email not confirmed"}};
      st.session=sessionFor(u);save();emit("SIGNED_IN");return{data:{session:st.session},error:null}},
    async signUp({email,password,options}){await wait();if(cfg.fail)return{data:{},error:NET};
      if(st.users.some(u=>u.email===email))return{data:{},error:{status:422,code:"user_already_exists",message:"User already registered"}};
      const u={id:"u"+st.seq++,email,password,confirmed:!cfg.confirmEmail};st.users.push(u);
      st.profiles.push({id:u.id,full_name:options.data.full_name,email,role:st.profiles.some(p=>p.role==="admin")?"employee":"admin",pto_allowance:0});
      if(cfg.confirmEmail){save();return{data:{user:{id:u.id},session:null},error:null}}
      st.session=sessionFor(u);save();emit("SIGNED_IN");return{data:{session:st.session},error:null}},
    async signOut(){await wait();st.session=null;save();emit("SIGNED_OUT");return{error:null}},
    async resetPasswordForEmail(){await wait();return cfg.fail?{data:{},error:NET}:{data:{},error:null}},
    async updateUser({password}){await wait();if(cfg.fail)return{data:{},error:NET};
      const u=st.users.find(u=>u.id===me());u.password=password;save();emit("USER_UPDATED");return{data:{},error:null}}}}}};
window.__fake={st,cfg,save,emit,setFail(b){cfg.fail=b;localStorage.setItem("fake-fail",b?"1":"0")}};
})();

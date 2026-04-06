import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";

const GOALS = ["Lose Weight","Gain Muscle","Maintain Weight","Improve Fitness","Increase Stamina"];
const ACTIVITY_LEVELS = [
  { label: "Sedentary (desk job, no exercise)", value: 1.2 },
  { label: "Lightly Active (1–3 days/week)", value: 1.375 },
  { label: "Moderately Active (3–5 days/week)", value: 1.55 },
  { label: "Very Active (6–7 days/week)", value: 1.725 },
];
const MOODS = ["Excellent","Good","Okay","Tired","Stressed","Bad"];
const GOAL_TYPES = [
  { value: "most_points", label: "Most Points" },
  { value: "longest_streak", label: "Longest Streak" },
  { value: "most_workouts", label: "Most Workouts" },
  { value: "weight_loss", label: "Most Weight Lost" },
];

function todayStr() { return new Date().toISOString().split("T")[0]; }
function weekStart() {
  const d = new Date(), day = d.getDay();
  return new Date(new Date().setDate(d.getDate() - day + (day===0?-6:1))).toISOString().split("T")[0];
}
function calcBMR(w,h,a,g){return g==="male"?10*w+6.25*h-5*a+5:10*w+6.25*h-5*a-161;}
function calcTDEE(w,h,a,g,act){return Math.round(calcBMR(w,h,a,g)*act);}
function calcTarget(tdee,goal){if(goal==="Lose Weight")return tdee-500;if(goal==="Gain Muscle")return tdee+300;return tdee;}
function calcBMI(w,h){return h>0?(w/(h/100)**2).toFixed(1):"—";}
function bmiCat(bmi){const b=+bmi;if(b<18.5)return{label:"Underweight",c:"#60a5fa"};if(b<25)return{label:"Normal",c:"#22c55e"};if(b<30)return{label:"Overweight",c:"#fbbf24"};return{label:"Obese",c:"#ef4444"};}
function pTarget(w,goal){return goal==="Gain Muscle"?Math.round(w*2.2):goal==="Lose Weight"?Math.round(w*2):Math.round(w*1.6);}
function cTarget(tdee,goal){return Math.round(calcTarget(tdee,goal)*0.45/4);}
function fTarget(tdee,goal){return Math.round(calcTarget(tdee,goal)*0.25/9);}
function ftInToCm(ft,inch){return Math.round((+ft*30.48)+(+inch*2.54));}
function cmToFtIn(cm){const t=cm/2.54;return{ft:Math.floor(t/12),inch:Math.round(t%12)};}
function fmtHeight(user){if(!user.height_cm)return"—";if(user.height_unit==="ft"){const{ft,inch}=cmToFtIn(user.height_cm);return`${ft}'${inch}"`;}return`${user.height_cm} cm`;}
function genCode(len=6){return Math.random().toString(36).toUpperCase().slice(2,2+len);}
function calcPts(log,user){
  if(!log)return 0;let p=0;
  const w=log.water||0,sl=log.sleep||0;
  if(w>=8)p+=20;else if(w>=6)p+=10;else if(w>=4)p+=5;
  if(sl>=7)p+=20;else if(sl>=6)p+=10;
  if(log.exercise&&log.exercise.trim().length>3)p+=30;
  const meals=Array.isArray(log.meals)?log.meals:[];
  if(meals.length>0)p+=5;
  if(user&&meals.length>0){
    const tdee=calcTDEE(user.weight,user.height_cm,user.age,user.gender,user.activity);
    const tgt=calcTarget(tdee,user.goal);const pt=pTarget(user.weight,user.goal);
    const totalCal=meals.reduce((s,m)=>s+(m.nutrition?.calories||0),0);
    const totalPro=meals.reduce((s,m)=>s+(m.nutrition?.protein||0),0);
    if(totalCal>0&&Math.abs(totalCal-tgt)<300)p+=15;
    if(totalPro>0&&totalPro>=pt*0.8)p+=15;
  }
  return Math.max(0,p);
}
function dayColor(log,user){if(!log)return null;const p=calcPts(log,user);return p>=60?"#22c55e":p>=35?"#fbbf24":"#ef4444";}
function getDaysInMonth(yr,mo){const days=[],d=new Date(yr,mo,1);while(d.getMonth()===mo){days.push(new Date(d));d.setDate(d.getDate()+1);}return days;}

// DB HELPERS
async function dbGetCommunity(joinCode){
  if(!joinCode||!joinCode.trim())return null;
  const{data}=await supabase.from("communities").select("*").eq("join_code",joinCode.toUpperCase().trim());
  return data&&data.length>0?data[0]:null;
}
async function dbLogin(username,password){const{data,error}=await supabase.from("profiles").select("*, communities(*)").eq("id",username).eq("password",password).single();if(error||!data)throw new Error("Invalid credentials");return data;}
async function dbSignUp(profile){const{error}=await supabase.from("profiles").insert(profile);if(error)throw new Error(error.message);}
async function dbCheckUsername(username){const{data}=await supabase.from("profiles").select("id").eq("id",username).single();return!!data;}
async function dbGetAllUsers(communityId){let q=supabase.from("profiles").select("*").eq("is_admin",false).eq("is_super_admin",false);if(communityId)q=q.eq("community_id",communityId);const{data}=await q.order("name");return data||[];}
async function dbGetLog(userId,date){const{data}=await supabase.from("daily_logs").select("*").eq("user_id",userId).eq("date",date).single();return data;}
async function dbSaveLog(userId,date,logData){const{error}=await supabase.from("daily_logs").upsert({user_id:userId,date,...logData},{onConflict:"user_id,date"});if(error)throw new Error(error.message);}
async function dbGetAllLogs(userId){const{data}=await supabase.from("daily_logs").select("*").eq("user_id",userId).order("date",{ascending:false});return data||[];}
async function dbGetWeight(userId,date){const{data}=await supabase.from("weight_logs").select("weight").eq("user_id",userId).eq("date",date).single();return data?.weight||null;}
async function dbSaveWeight(userId,date,weight){await supabase.from("weight_logs").upsert({user_id:userId,date,weight},{onConflict:"user_id,date"});}
async function dbGetAllWeights(userId){const{data}=await supabase.from("weight_logs").select("*").eq("user_id",userId).order("date");return data||[];}
async function dbGetMeasurement(userId,week){const{data}=await supabase.from("measurements").select("*").eq("user_id",userId).eq("week_start",week).single();return data;}
async function dbSaveMeasurement(userId,week,meas){await supabase.from("measurements").upsert({user_id:userId,week_start:week,...meas},{onConflict:"user_id,week_start"});}
async function dbGetAllMeasurements(userId){const{data}=await supabase.from("measurements").select("*").eq("user_id",userId).order("week_start",{ascending:false});return data||[];}
async function dbGetNotifTime(userId){const{data}=await supabase.from("notifications").select("notif_time").eq("user_id",userId).single();return data?.notif_time||"";}
async function dbSaveNotifTime(userId,time){await supabase.from("notifications").upsert({user_id:userId,notif_time:time},{onConflict:"user_id"});}
async function dbGetWeeklyPoints(users,weekStartDate){
  if(!users.length)return{};
  const ids=users.map(u=>u.id);
  const{data}=await supabase.from("daily_logs").select("user_id,meals,exercise,water,sleep").gte("date",weekStartDate).in("user_id",ids);
  const pts={};ids.forEach(id=>pts[id]=0);
  (data||[]).forEach(log=>{const u=users.find(u=>u.id===log.user_id);pts[log.user_id]=(pts[log.user_id]||0)+calcPts(log,u);});
  return pts;
}
async function dbGetFollowStatus(ferId,fingId){const{data}=await supabase.from("follows").select("status").eq("follower_id",ferId).eq("following_id",fingId).single();return data?.status||null;}
async function dbSendFollow(ferId,fingId){await supabase.from("follows").upsert({follower_id:ferId,following_id:fingId,status:"pending"},{onConflict:"follower_id,following_id"});}
async function dbAcceptFollow(ferId,fingId){await supabase.from("follows").update({status:"accepted"}).eq("follower_id",ferId).eq("following_id",fingId);}
async function dbGetFollowRequests(userId){const{data}=await supabase.from("follows").select("*, profiles!follows_follower_id_fkey(id,name)").eq("following_id",userId).eq("status","pending");return data||[];}
async function dbGetFollowers(userId){const{data}=await supabase.from("follows").select("*, profiles!follows_follower_id_fkey(id,name,goal)").eq("following_id",userId).eq("status","accepted");return data||[];}
async function dbGetFollowing(userId){const{data}=await supabase.from("follows").select("*, profiles!follows_following_id_fkey(id,name,goal)").eq("follower_id",userId).eq("status","accepted");return data||[];}
async function dbSearchUsers(query,currentUserId){const{data}=await supabase.from("profiles").select("id,name,goal,is_public,community_id,communities(name)").eq("is_public",true).neq("id",currentUserId).neq("is_admin",true).ilike("id",`%${query}%`).limit(10);return data||[];}
async function dbCreateChallenge(challenge){const{data,error}=await supabase.from("challenges").insert(challenge).select().single();if(error)throw new Error(error.message);return data;}
async function dbGetChallengeByCode(code){const{data}=await supabase.from("challenges").select("*, profiles!challenges_creator_id_fkey(name)").eq("join_code",code.toUpperCase()).single();return data;}
async function dbJoinChallenge(challengeId,userId){const{error}=await supabase.from("challenge_members").upsert({challenge_id:challengeId,user_id:userId},{onConflict:"challenge_id,user_id"});if(error)throw new Error(error.message);}
async function dbGetMyChallenges(userId){const{data}=await supabase.from("challenge_members").select("*, challenges(*, profiles!challenges_creator_id_fkey(name))").eq("user_id",userId);return(data||[]).map(d=>d.challenges).filter(Boolean);}
async function dbGetChallengeMembers(challengeId){const{data}=await supabase.from("challenge_members").select("*, profiles(id,name,goal,weight,height_cm,gender,age,activity)").eq("challenge_id",challengeId);return data||[];}
async function dbGetAllCommunities(){const{data}=await supabase.from("communities").select("*").order("name");return data||[];}
async function dbUpdateProfile(userId,updates){await supabase.from("profiles").update(updates).eq("id",userId);}
async function dbUnfollow(followerId,followingId){await supabase.from("follows").delete().eq("follower_id",followerId).eq("following_id",followingId);}
async function dbGetPublicProfile(userId){const{data}=await supabase.from("profiles").select("id,name,goal,weight,height_cm,height_unit,age,gender,activity,bio,is_public,profile_visible,communities(name,logo_emoji)").eq("id",userId).eq("is_public",true).single();return data;}
async function dbGetUserStreak(userId){
  const{data}=await supabase.from("daily_logs").select("date").eq("user_id",userId).order("date",{ascending:false});
  let s=0;const dateSet=new Set((data||[]).map(d=>d.date));let chk=new Date();
  for(let i=0;i<365;i++){const k=chk.toISOString().split("T")[0];if(dateSet.has(k)){s++;chk.setDate(chk.getDate()-1);}else break;}
  return s;
}
async function dbGetUserWeightChange(userId){
  const{data}=await supabase.from("weight_logs").select("weight,date").eq("user_id",userId).order("date");
  if(!data||data.length<2)return null;
  return{first:data[0].weight,latest:data[data.length-1].weight,change:+(data[data.length-1].weight-data[0].weight).toFixed(1)};
}
async function dbSearchScopedUsers(query,currentUserId,communityId){
  // Get challenge peer IDs
  const{data:myChals}=await supabase.from("challenge_members").select("challenge_id").eq("user_id",currentUserId);
  const myChalIds=(myChals||[]).map(c=>c.challenge_id);
  let peerIds=new Set();
  if(communityId){
    const{data:commUsers}=await supabase.from("profiles").select("id").eq("community_id",communityId).neq("id",currentUserId);
    (commUsers||[]).forEach(u=>peerIds.add(u.id));
  }
  if(myChalIds.length>0){
    const{data:chalMembers}=await supabase.from("challenge_members").select("user_id").in("challenge_id",myChalIds).neq("user_id",currentUserId);
    (chalMembers||[]).forEach(m=>peerIds.add(m.user_id));
  }
  if(!peerIds.size)return[];
  const ids=[...peerIds];
  const{data}=await supabase.from("profiles").select("id,name,goal,is_public,community_id,communities(name)").in("id",ids).eq("is_public",true).neq("is_admin",true).ilike("id",`%${query}%`).limit(15);
  return data||[];
}

// AI
async function callClaude(prompt,maxTokens=1000){
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:maxTokens,messages:[{role:"user",content:prompt}]})});
  if(!res.ok)throw new Error(`API ${res.status}`);
  const data=await res.json();return data.content?.[0]?.text||"";
}
async function estimateMealNutrition(mealText){
  const raw=await callClaude(`Nutrition expert. Estimate macros for: "${mealText}"\nReply ONLY with raw JSON:\n{"calories":0,"protein":0,"carbs":0,"fats":0,"items":[{"name":"food","calories":0,"protein":0,"carbs":0,"fats":0}],"note":""}\nReference: 1 egg=70cal/6gP, 1 roti=80cal/3gP, 1 cup rice=200cal/4gP, 1 bowl dal=130cal/8gP, 1 scoop whey=120cal/25gP, 100g chicken=165cal/31gP`,500);
  const s=raw.indexOf("{"),e=raw.lastIndexOf("}");if(s===-1||e===-1)throw new Error("Bad JSON");return JSON.parse(raw.slice(s,e+1));
}
async function generateReport(user,mealsList,exercise,water,sleep,mood,notes,tCal,pTgt,cTgt,fTgt,streak){
  const totalCal=mealsList.reduce((s,m)=>s+(m.nutrition?.calories||0),0);
  const totalPro=mealsList.reduce((s,m)=>s+(m.nutrition?.protein||0),0);
  const mealsDesc=mealsList.length>0?mealsList.map((m,i)=>`Meal ${i+1}: ${m.description} → ${m.nutrition?.calories||0}kcal, P:${m.nutrition?.protein||0}g`).join("\n"):"No meals logged";
  return await callClaude(`You are a warm Indian health coach. Write a daily health report.\nUser: ${user.name}, ${user.age}y, ${user.weight}kg, Goal: ${user.goal}\nTargets: ${tCal}kcal | Protein ${pTgt}g | Carbs ${cTgt}g | Fats ${fTgt}g\nMeals: ${mealsDesc}\nTotals: ${totalCal}kcal, ${totalPro}g protein\nExercise: ${exercise||"none"} | Water: ${water}gl | Sleep: ${sleep}h | Mood: ${mood} | Streak: ${streak}d\n\nWrite with EXACT headers:\n🌅 DAILY SUMMARY\n✅ GOOD HIGHLIGHTS\n⚠️ AREAS TO IMPROVE\n🍽️ NUTRITION VERDICT\n💪 EXERCISE VERDICT\n🎯 GOAL PROGRESS\n📋 TOMORROW'S FOCUS\n\nWarm, Indian-context, specific. Max 350 words.`,1000);
}

function checkNotif(userId,timeStr){
  if(!timeStr||!("Notification"in window)||Notification.permission!=="granted")return;
  const[h,m]=timeStr.split(":").map(Number);const now=new Date(),target=new Date();target.setHours(h,m,0,0);
  const lastKey=`notif_last_${userId}`;
  if(Math.abs(now-target)<60000&&localStorage.getItem(lastKey)!==todayStr()){
    new Notification("⚖️ FitFamily — Time to weigh in!",{body:"Log your weight 💪"});localStorage.setItem(lastKey,todayStr());
  }
}

// STYLES
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
input:focus,select:focus,textarea:focus{outline:none!important;border-color:rgba(251,191,36,0.5)!important;}
button:active{transform:scale(0.97);}
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-thumb{background:rgba(251,191,36,0.2);border-radius:4px;}
`;
const BG="radial-gradient(ellipse at 20% 60%, #0a2010 0%, #060c08 65%, #0a1812 100%)";
const IS={width:"100%",padding:"10px 13px",background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:9,color:"#fff",fontSize:14,fontFamily:"'DM Sans',sans-serif",boxSizing:"border-box"};
const TS={...IS,resize:"vertical",minHeight:80};
const SS={...IS,background:"#0d1f0d"};
const CARD={background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14};
const SEC={...CARD,padding:"1.1rem 1.4rem",marginBottom:12};
const LBL={display:"block",color:"rgba(255,255,255,0.42)",fontSize:11,fontWeight:600,letterSpacing:0.9,textTransform:"uppercase",marginBottom:5};
const STITLE={color:"rgba(255,255,255,0.42)",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:0.9,marginBottom:10};

function Spin({s=32,c="#fbbf24"}){return<div style={{width:s,height:s,border:`2.5px solid ${c}30`,borderTop:`2.5px solid ${c}`,borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>;}
function Tag({children,color="#fbbf24"}){return<span style={{display:"inline-flex",alignItems:"center",padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:600,background:color+"1a",color,border:`1px solid ${color}35`}}>{children}</span>;}
function Card({children,style={}}){return<div style={{...CARD,padding:"1.1rem 1.3rem",...style}}>{children}</div>;}
function Btn({children,onClick,variant="primary",disabled=false,style={}}){
  const V={primary:{background:"linear-gradient(135deg,#fbbf24,#f59e0b)",color:"#0d1a00",fontWeight:700,border:"none"},ghost:{background:"rgba(255,255,255,0.05)",color:"rgba(255,255,255,0.65)",border:"1px solid rgba(255,255,255,0.1)"},danger:{background:"rgba(239,68,68,0.1)",color:"#f87171",border:"1px solid rgba(239,68,68,0.22)"},success:{background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",fontWeight:700,border:"none"},outline:{background:"transparent",color:"#fbbf24",border:"1px solid rgba(251,191,36,0.4)",fontWeight:600}};
  return<button onClick={onClick} disabled={disabled} style={{padding:"9px 16px",borderRadius:9,cursor:disabled?"not-allowed":"pointer",fontSize:14,fontFamily:"'DM Sans',sans-serif",transition:"all 0.15s",opacity:disabled?0.5:1,...V[variant],...style}}>{children}</button>;
}
function FInput({label,...props}){return<div style={{marginBottom:12}}>{label&&<label style={LBL}>{label}</label>}<input {...props} style={{...IS,...props.style}}/></div>;}
function FSelect({label,children,...props}){return<div style={{marginBottom:12}}>{label&&<label style={LBL}>{label}</label>}<select {...props} style={{...SS,...props.style}}>{children}</select></div>;}

// AUTH SCREEN
function AuthScreen({onLogin}){
  // mode: "landing" | "login" | "member" | "gym"
  // member steps: 1=code, 2=account, 3=profile
  // gym steps: 1=gym info, 2=admin account
  const[mode,setMode]=useState("landing");
  const[step,setStep]=useState(1);
  const[community,setCommunity]=useState(null);
  const[createdComm,setCreatedComm]=useState(null); // for gym signup success screen
  const[form,setForm]=useState({
    // shared
    username:"",password:"",confirmPassword:"",name:"",email:"",
    // member
    joinCode:"",age:"",weight:"",heightUnit:"cm",heightCm:"",heightFt:"",heightIn:"",gender:"male",goal:"Lose Weight",activity:1.55,
    // gym
    gymName:"",gymType:"gym",gymCity:"",gymCode:"",gymEmoji:"🏋️",adminName:"",adminEmail:"",
  });
  const[err,setErr]=useState("");
  const[loading,setLoading]=useState(false);
  const F=(k,v)=>setForm(p=>({...p,[k]:v}));
  const reset=()=>{setErr("");setStep(1);setForm({username:"",password:"",confirmPassword:"",name:"",email:"",joinCode:"",age:"",weight:"",heightUnit:"cm",heightCm:"",heightFt:"",heightIn:"",gender:"male",goal:"Lose Weight",activity:1.55,gymName:"",gymType:"gym",gymCity:"",gymCode:"",gymEmoji:"🏋️",adminName:"",adminEmail:""});};

  // ── Login ──
  async function handleLogin(){
    if(!form.username||!form.password){setErr("Fill all fields.");return;}
    setLoading(true);setErr("");
    try{const user=await dbLogin(form.username.trim(),form.password);localStorage.setItem("fitfamily_session",JSON.stringify({id:user.id,password:user.password}));onLogin(user);}
    catch{setErr("Invalid username or password.");}
    setLoading(false);
  }

  // ── Member signup ──
  async function handleMemberStep1(){
    if(!form.joinCode.trim()){setErr("Enter a community code.");return;}
    setErr("");setLoading(true);
    try{
      const comm=await dbGetCommunity(form.joinCode);
      if(!comm){setErr("❌ Invalid community code. Check with your gym or society admin.");setLoading(false);return;}
      setCommunity(comm);setStep(2);
    }catch{setErr("Could not connect. Check your internet and try again.");}
    setLoading(false);
  }
  async function handleMemberStep2(){
    setErr("");
    if(!form.username||!form.password||!form.name){setErr("Fill all fields.");return;}
    if(form.password!==form.confirmPassword){setErr("Passwords don't match.");return;}
    if(form.username.length<3){setErr("Username must be at least 3 characters.");return;}
    if(!/^[a-z0-9_]+$/.test(form.username)){setErr("Username: only lowercase letters, numbers, underscores.");return;}
    setLoading(true);
    const exists=await dbCheckUsername(form.username);
    if(exists){setErr("Username taken. Try another.");setLoading(false);return;}
    setStep(3);setLoading(false);
  }
  async function handleMemberFinish(){
    setErr("");setLoading(true);
    if(!form.age||!form.weight){setErr("Fill age and weight.");setLoading(false);return;}
    let heightCm=form.heightUnit==="cm"?+form.heightCm:ftInToCm(form.heightFt||0,form.heightIn||0);
    if(heightCm<100||heightCm>250){setErr("Enter a valid height.");setLoading(false);return;}
    try{
      await dbSignUp({id:form.username,name:form.name,email:form.email,password:form.password,community_id:community.id,age:+form.age,weight:+form.weight,height_cm:heightCm,height_unit:form.heightUnit,gender:form.gender,goal:form.goal,activity:+form.activity,is_admin:false,is_super_admin:false});
      const user=await dbLogin(form.username,form.password);
      localStorage.setItem("fitfamily_session",JSON.stringify({id:user.id,password:user.password}));onLogin(user);
    }catch(e){setErr(e.message);}
    setLoading(false);
  }

  // ── Gym / Society signup ──
  async function handleGymStep1(){
    setErr("");
    if(!form.gymName.trim()||!form.gymCode.trim()){setErr("Fill gym name and join code.");return;}
    if(form.gymCode.length<4){setErr("Join code must be at least 4 characters.");return;}
    if(!/^[A-Z0-9]+$/.test(form.gymCode.toUpperCase())){setErr("Join code: only letters and numbers.");return;}
    setLoading(true);
    // Check if code already taken
    const existing=await dbGetCommunity(form.gymCode);
    if(existing){setErr("That join code is already taken. Choose a different one.");setLoading(false);return;}
    setStep(2);setLoading(false);
  }
  async function handleGymFinish(){
    setErr("");
    if(!form.adminName||!form.username||!form.password){setErr("Fill all fields.");return;}
    if(form.password!==form.confirmPassword){setErr("Passwords don't match.");return;}
    if(form.username.length<3){setErr("Username must be at least 3 characters.");return;}
    if(!/^[a-z0-9_]+$/.test(form.username)){setErr("Username: only lowercase letters, numbers, underscores.");return;}
    setLoading(true);
    try{
      // Check username
      const exists=await dbCheckUsername(form.username);
      if(exists){setErr("Username taken. Try another.");setLoading(false);return;}
      // Create the community
      const{data:comm,error:commErr}=await supabase.from("communities").insert({
        name:form.gymName.trim(),type:form.gymType,city:form.gymCity.trim(),
        join_code:form.gymCode.toUpperCase(),admin_password:form.password,logo_emoji:form.gymEmoji,
      }).select().single();
      if(commErr)throw new Error(commErr.message);
      // Create admin account
      await dbSignUp({id:form.username,name:form.adminName,email:form.adminEmail||form.email,password:form.password,community_id:comm.id,age:30,weight:70,height_cm:170,gender:"male",goal:"Maintain Weight",activity:1.55,is_admin:true,is_super_admin:false});
      setCreatedComm({...comm,adminUsername:form.username});
      setStep(3);
    }catch(e){setErr(e.message);}
    setLoading(false);
  }
  async function handleGymLogin(){
    try{
      const user=await dbLogin(createdComm.adminUsername,form.password);
      localStorage.setItem("fitfamily_session",JSON.stringify({id:user.id,password:user.password}));
      onLogin(user);
    }catch(e){setErr(e.message);}
  }

  const ce=community?.logo_emoji||"🏋️";
  const EMOJIS=["🏋️","💪","🧘","🏃","⚽","🏊","🚴","🥊","🏠","🌿","🦁","🔥"];

  // Subtitle per mode/step
  const subtitle=()=>{
    if(mode==="landing")return"Community fitness platform";
    if(mode==="login")return"Sign in to your account";
    if(mode==="member"){if(step===1)return"Enter your community code";if(step===2)return"Create your account";return"Set up your profile";}
    if(mode==="gym"){if(step===1)return"Register your gym or society";if(step===2)return"Create admin account";return"You're all set!";}
    return"";
  };

  return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",padding:"1rem"}}>
      <style>{CSS}</style>
      <div style={{width:"100%",maxWidth:420,animation:"fadeUp 0.5s ease"}}>
        {/* Header */}
        <div style={{textAlign:"center",marginBottom:"1.8rem"}}>
          <div style={{fontSize:48,marginBottom:8}}>{mode==="gym"&&step===3&&createdComm?createdComm.logo_emoji:community?ce:mode==="gym"?"🏢":"🏆"}</div>
          <h1 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:28,fontWeight:700,letterSpacing:"-0.5px"}}>FitFamily</h1>
          {community&&<p style={{color:"#fbbf24",fontSize:13,marginTop:4,fontWeight:600}}>{community.name}</p>}
          <p style={{color:"rgba(255,255,255,0.28)",fontSize:12,marginTop:4,textTransform:"uppercase",letterSpacing:"1px"}}>{subtitle()}</p>
        </div>

        {/* ── LANDING ── */}
        {mode==="landing"&&(
          <div>
            <div style={{display:"grid",gap:12,marginBottom:16}}>
              <button onClick={()=>{reset();setMode("member");}} style={{padding:"18px",borderRadius:14,border:"1px solid rgba(255,255,255,0.1)",background:"rgba(255,255,255,0.04)",cursor:"pointer",textAlign:"left",fontFamily:"'DM Sans',sans-serif",transition:"all 0.2s"}}>
                <div style={{fontSize:28,marginBottom:6}}>👤</div>
                <div style={{color:"#fff",fontWeight:600,fontSize:16,marginBottom:3}}>I'm a Member</div>
                <div style={{color:"rgba(255,255,255,0.4)",fontSize:12,lineHeight:1.5}}>Join your gym or society's fitness community using an invite code</div>
              </button>
              <button onClick={()=>{reset();setMode("gym");}} style={{padding:"18px",borderRadius:14,border:"1px solid rgba(251,191,36,0.25)",background:"rgba(251,191,36,0.04)",cursor:"pointer",textAlign:"left",fontFamily:"'DM Sans',sans-serif",transition:"all 0.2s"}}>
                <div style={{fontSize:28,marginBottom:6}}>🏢</div>
                <div style={{color:"#fbbf24",fontWeight:600,fontSize:16,marginBottom:3}}>I'm a Gym / Society</div>
                <div style={{color:"rgba(255,255,255,0.4)",fontSize:12,lineHeight:1.5}}>Set up your community, create invite codes, and manage your members</div>
              </button>
            </div>
            <p style={{textAlign:"center",color:"rgba(255,255,255,0.4)",fontSize:13}}>
              Already have an account?{" "}
              <span onClick={()=>{reset();setMode("login");}} style={{color:"#fbbf24",cursor:"pointer",fontWeight:600}}>Sign In</span>
            </p>
          </div>
        )}

        {/* ── LOGIN ── */}
        {mode==="login"&&(
          <Card style={{padding:"1.8rem"}}>
            <FInput label="Username" value={form.username} onChange={e=>F("username",e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="your_username"/>
            <FInput label="Password" type="password" value={form.password} onChange={e=>F("password",e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="••••••••"/>
            {err&&<p style={{color:"#f87171",fontSize:13,marginBottom:12,textAlign:"center"}}>{err}</p>}
            <Btn onClick={handleLogin} disabled={loading} style={{width:"100%",padding:"12px",fontSize:15,marginBottom:14}}>{loading?"Signing in...":"Sign In →"}</Btn>
            <p style={{textAlign:"center",color:"rgba(255,255,255,0.4)",fontSize:13}}>
              <span onClick={()=>{reset();setMode("landing");}} style={{color:"rgba(255,255,255,0.4)",cursor:"pointer"}}>← Back</span>
              {"  ·  "}
              <span onClick={()=>{reset();setMode("member");}} style={{color:"#fbbf24",cursor:"pointer",fontWeight:600}}>Sign Up</span>
            </p>
          </Card>
        )}

        {/* ── MEMBER SIGNUP ── */}
        {mode==="member"&&(
          <Card style={{padding:"1.8rem"}}>
            {/* Back link */}
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
              <span onClick={()=>{if(step===1){reset();setMode("landing");}else setStep(s=>s-1);}} style={{color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:13}}>← Back</span>
              <div style={{flex:1,display:"flex",gap:6,justifyContent:"flex-end"}}>
                {[1,2,3].map(s=><div key={s} style={{width:s===step?20:6,height:6,borderRadius:3,background:s===step?"#fbbf24":s<step?"rgba(251,191,36,0.4)":"rgba(255,255,255,0.1)",transition:"all 0.3s"}}/>)}
              </div>
            </div>

            {step===1&&<>
              <p style={{color:"rgba(255,255,255,0.5)",fontSize:13,marginBottom:16,lineHeight:1.6}}>Ask your gym or society manager for the <strong style={{color:"#fbbf24"}}>community code</strong> to get started.</p>
              <FInput label="Community Code" value={form.joinCode} onChange={e=>F("joinCode",e.target.value.toUpperCase())} placeholder="e.g. BLKVGR" style={{textTransform:"uppercase",letterSpacing:3,fontSize:20,textAlign:"center"}}/>
              {err&&<p style={{color:"#f87171",fontSize:13,marginBottom:12,textAlign:"center"}}>{err}</p>}
              <Btn onClick={handleMemberStep1} disabled={loading} style={{width:"100%",padding:"12px",fontSize:15}}>{loading?"Checking...":"Continue →"}</Btn>
            </>}

            {step===2&&<>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,padding:"8px 12px",background:"rgba(251,191,36,0.08)",borderRadius:8,border:"1px solid rgba(251,191,36,0.2)"}}>
                <span style={{fontSize:20}}>{ce}</span>
                <div><div style={{color:"#fbbf24",fontWeight:600,fontSize:13}}>{community?.name}</div><div style={{color:"rgba(255,255,255,0.4)",fontSize:11}}>{community?.city} · {community?.type}</div></div>
              </div>
              <FInput label="Full Name" value={form.name} onChange={e=>F("name",e.target.value)} placeholder="e.g. Priya Sharma"/>
              <FInput label="Username" value={form.username} onChange={e=>F("username",e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,""))} placeholder="e.g. priya123 (letters, numbers, _)"/>
              <FInput label="Email (optional)" type="email" value={form.email} onChange={e=>F("email",e.target.value)} placeholder="your@email.com"/>
              <FInput label="Password" type="password" value={form.password} onChange={e=>F("password",e.target.value)} placeholder="Create a password"/>
              <FInput label="Confirm Password" type="password" value={form.confirmPassword} onChange={e=>F("confirmPassword",e.target.value)} placeholder="Repeat password"/>
              {err&&<p style={{color:"#f87171",fontSize:13,marginBottom:12,textAlign:"center"}}>{err}</p>}
              <Btn onClick={handleMemberStep2} disabled={loading} style={{width:"100%",padding:"12px",fontSize:15}}>{loading?"Checking...":"Continue →"}</Btn>
            </>}

            {step===3&&<>
              <p style={{...STITLE,marginBottom:14}}>Tell us about yourself</p>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <FInput label="Age" type="number" value={form.age} onChange={e=>F("age",e.target.value)} placeholder="28"/>
                <FInput label="Weight (kg)" type="number" value={form.weight} onChange={e=>F("weight",e.target.value)} placeholder="70"/>
              </div>
              <div style={{marginBottom:12}}>
                <label style={LBL}>Height</label>
                <div style={{display:"flex",gap:8,marginBottom:6}}>
                  {["cm","ft"].map(u=><button key={u} onClick={()=>F("heightUnit",u)} style={{flex:1,padding:"8px",borderRadius:8,border:`1px solid ${form.heightUnit===u?"rgba(251,191,36,0.5)":"rgba(255,255,255,0.1)"}`,background:form.heightUnit===u?"rgba(251,191,36,0.1)":"transparent",color:form.heightUnit===u?"#fbbf24":"rgba(255,255,255,0.5)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13}}>{u==="cm"?"cm":"ft / in"}</button>)}
                </div>
                {form.heightUnit==="cm"?<input type="number" value={form.heightCm} onChange={e=>F("heightCm",e.target.value)} placeholder="e.g. 175" style={IS}/>:<div style={{display:"flex",gap:8}}><input type="number" value={form.heightFt} onChange={e=>F("heightFt",e.target.value)} placeholder="5 ft" style={{...IS,flex:1}}/><input type="number" value={form.heightIn} onChange={e=>F("heightIn",e.target.value)} placeholder="11 in" style={{...IS,flex:1}}/></div>}
              </div>
              <FSelect label="Gender" value={form.gender} onChange={e=>F("gender",e.target.value)}><option value="male">Male</option><option value="female">Female</option></FSelect>
              <FSelect label="Fitness Goal" value={form.goal} onChange={e=>F("goal",e.target.value)}>{GOALS.map(g=><option key={g} value={g}>{g}</option>)}</FSelect>
              <FSelect label="Activity Level" value={form.activity} onChange={e=>F("activity",e.target.value)}>{ACTIVITY_LEVELS.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}</FSelect>
              {err&&<p style={{color:"#f87171",fontSize:13,marginBottom:12,textAlign:"center"}}>{err}</p>}
              <Btn onClick={handleMemberFinish} disabled={loading} style={{width:"100%",padding:"12px",fontSize:15}}>{loading?"Creating account...":"Start My Journey 🚀"}</Btn>
            </>}
          </Card>
        )}

        {/* ── GYM / SOCIETY SIGNUP ── */}
        {mode==="gym"&&(
          <Card style={{padding:"1.8rem"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
              <span onClick={()=>{if(step===1){reset();setMode("landing");}else if(step===2)setStep(1);}} style={{color:"rgba(255,255,255,0.4)",cursor:"pointer",fontSize:13}}>← Back</span>
              {step<3&&<div style={{flex:1,display:"flex",gap:6,justifyContent:"flex-end"}}>
                {[1,2].map(s=><div key={s} style={{width:s===step?20:6,height:6,borderRadius:3,background:s===step?"#fbbf24":s<step?"rgba(251,191,36,0.4)":"rgba(255,255,255,0.1)",transition:"all 0.3s"}}/>)}
              </div>}
            </div>

            {step===1&&<>
              <p style={{...STITLE,marginBottom:14}}>Your Gym / Society Details</p>
              <FInput label="Gym / Society Name" value={form.gymName} onChange={e=>F("gymName",e.target.value)} placeholder="e.g. Black Vigour Gym"/>
              <FSelect label="Type" value={form.gymType} onChange={e=>F("gymType",e.target.value)}>
                <option value="gym">Gym</option>
                <option value="society">Residential Society / RWA</option>
                <option value="corporate">Corporate Wellness</option>
                <option value="sports">Sports Club</option>
              </FSelect>
              <FInput label="City" value={form.gymCity} onChange={e=>F("gymCity",e.target.value)} placeholder="e.g. Delhi"/>
              <div style={{marginBottom:12}}>
                <label style={LBL}>Member Join Code</label>
                <p style={{color:"rgba(255,255,255,0.35)",fontSize:11,marginBottom:6}}>Members will enter this code to join your community. Keep it simple and memorable.</p>
                <input value={form.gymCode} onChange={e=>F("gymCode",e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""))} placeholder="e.g. BLKVGR" style={{...IS,textTransform:"uppercase",letterSpacing:4,fontSize:18,textAlign:"center"}} maxLength={10}/>
              </div>
              <div style={{marginBottom:16}}>
                <label style={LBL}>Logo Emoji</label>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {EMOJIS.map(e=><button key={e} onClick={()=>F("gymEmoji",e)} style={{fontSize:22,padding:"6px 8px",borderRadius:8,border:`2px solid ${form.gymEmoji===e?"#fbbf24":"rgba(255,255,255,0.1)"}`,background:form.gymEmoji===e?"rgba(251,191,36,0.1)":"transparent",cursor:"pointer"}}>{e}</button>)}
                </div>
              </div>
              {err&&<p style={{color:"#f87171",fontSize:13,marginBottom:12,textAlign:"center"}}>{err}</p>}
              <Btn onClick={handleGymStep1} disabled={loading} style={{width:"100%",padding:"12px",fontSize:15}}>{loading?"Checking...":"Continue →"}</Btn>
            </>}

            {step===2&&<>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16,padding:"10px 12px",background:"rgba(251,191,36,0.08)",borderRadius:8,border:"1px solid rgba(251,191,36,0.2)"}}>
                <span style={{fontSize:24}}>{form.gymEmoji}</span>
                <div><div style={{color:"#fbbf24",fontWeight:600,fontSize:14}}>{form.gymName}</div><div style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>Join code: <strong style={{color:"#fbbf24",letterSpacing:2}}>{form.gymCode}</strong></div></div>
              </div>
              <p style={{...STITLE,marginBottom:14}}>Create Your Admin Account</p>
              <FInput label="Your Name" value={form.adminName} onChange={e=>F("adminName",e.target.value)} placeholder="e.g. Rajesh Kumar"/>
              <FInput label="Admin Username" value={form.username} onChange={e=>F("username",e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,""))} placeholder="e.g. blkvgr_admin"/>
              <FInput label="Email (optional)" type="email" value={form.adminEmail} onChange={e=>F("adminEmail",e.target.value)} placeholder="admin@yourgym.com"/>
              <FInput label="Password" type="password" value={form.password} onChange={e=>F("password",e.target.value)} placeholder="Create a strong password"/>
              <FInput label="Confirm Password" type="password" value={form.confirmPassword} onChange={e=>F("confirmPassword",e.target.value)} placeholder="Repeat password"/>
              {err&&<p style={{color:"#f87171",fontSize:13,marginBottom:12,textAlign:"center"}}>{err}</p>}
              <Btn onClick={handleGymFinish} disabled={loading} style={{width:"100%",padding:"12px",fontSize:15}}>{loading?"Creating your community...":"Create Community 🚀"}</Btn>
            </>}

            {step===3&&createdComm&&<>
              <div style={{textAlign:"center",padding:"0.5rem 0 1.2rem"}}>
                <div style={{fontSize:52,marginBottom:10}}>{createdComm.logo_emoji}</div>
                <h3 style={{fontFamily:"'Playfair Display',serif",color:"#22c55e",fontSize:20,marginBottom:6}}>🎉 Community Created!</h3>
                <p style={{color:"rgba(255,255,255,0.5)",fontSize:13,lineHeight:1.6}}>Your community is live. Share the join code with your members.</p>
              </div>
              <div style={{background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.25)",borderRadius:12,padding:"1.2rem",marginBottom:16,textAlign:"center"}}>
                <p style={{color:"rgba(255,255,255,0.45)",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Member Join Code</p>
                <div style={{fontSize:32,fontFamily:"monospace",color:"#fbbf24",fontWeight:700,letterSpacing:8,marginBottom:8}}>{createdComm.join_code}</div>
                <p style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>Members enter this code when signing up on FitFamily</p>
              </div>
              <div style={{background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"0.8rem 1rem",marginBottom:16,fontSize:12,color:"rgba(255,255,255,0.45)"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span>Community</span><span style={{color:"#fff",fontWeight:600}}>{createdComm.name}</span></div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span>Your Username</span><span style={{color:"#fff",fontWeight:600}}>@{createdComm.adminUsername}</span></div>
                <div style={{display:"flex",justifyContent:"space-between"}}><span>App URL</span><span style={{color:"#fbbf24"}}>fitfamily-six.vercel.app</span></div>
              </div>
              <Btn onClick={handleGymLogin} style={{width:"100%",padding:"12px",fontSize:15}}>Go to Admin Panel →</Btn>
            </>}
          </Card>
        )}

        {(mode==="login"||mode==="member"||mode==="gym")&&mode!=="landing"&&(
          <p style={{textAlign:"center",marginTop:14,color:"rgba(255,255,255,0.3)",fontSize:12}}>
            By signing up you agree to use this platform responsibly.
          </p>
        )}
      </div>
    </div>
  );
}

// CALENDAR
function CalView({logs,user,onSelect,selected}){
  const now=new Date();
  const[yr,setYr]=useState(now.getFullYear());
  const[mo,setMo]=useState(now.getMonth());
  const today=todayStr();
  const days=getDaysInMonth(yr,mo);
  const firstDow=new Date(yr,mo,1).getDay();
  const cells=Array(firstDow).fill(null).concat(days);
  const mName=new Date(yr,mo,1).toLocaleString("default",{month:"long"});
  const logMap={};logs.forEach(l=>{logMap[l.date]=l;});
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <button onClick={()=>mo===0?(setYr(y=>y-1),setMo(11)):setMo(m=>m-1)} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)",borderRadius:6,padding:"3px 10px",fontSize:14,cursor:"pointer"}}>‹</button>
        <span style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:15,fontWeight:700}}>{mName} {yr}</span>
        <button onClick={()=>mo===11?(setYr(y=>y+1),setMo(0)):setMo(m=>m+1)} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.4)",borderRadius:6,padding:"3px 10px",fontSize:14,cursor:"pointer"}}>›</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>
        {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{textAlign:"center",color:"rgba(255,255,255,0.22)",fontSize:10,fontWeight:600,padding:"3px 0"}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
        {cells.map((d,i)=>{
          if(!d)return<div key={i}/>;
          const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          const log=logMap[ds];const col=log?dayColor(log,user):null;
          const isToday=ds===today,isSel=ds===selected,isFuture=ds>today;
          return<button key={i} onClick={()=>!isFuture&&onSelect(ds)} style={{aspectRatio:"1",borderRadius:7,border:isSel?"2px solid #fbbf24":"1px solid transparent",background:isToday?"rgba(255,255,255,0.12)":col?col+"20":"rgba(255,255,255,0.02)",color:isToday?"#fff":col?col:"rgba(255,255,255,0.2)",fontSize:12,fontWeight:isSel||isToday?700:400,cursor:isFuture?"default":"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,position:"relative"}}>
            {d.getDate()}{col&&<div style={{position:"absolute",bottom:2,left:"50%",transform:"translateX(-50%)",width:3,height:3,borderRadius:"50%",background:col}}/>}
          </button>;
        })}
      </div>
      <div style={{display:"flex",gap:12,marginTop:10,justifyContent:"center"}}>
        {[["#22c55e","Great"],["#fbbf24","Good"],["#ef4444","Poor"],["rgba(255,255,255,0.15)","Today"]].map(([c,l])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:7,height:7,borderRadius:"50%",background:c}}/><span style={{color:"rgba(255,255,255,0.3)",fontSize:10}}>{l}</span></div>
        ))}
      </div>
    </div>
  );
}

// DAY REPORT
function DayReport({log,user,wt,tCal,tPro,tCar,tFat}){
  if(!log)return<p style={{color:"rgba(255,255,255,0.3)",padding:"2rem",textAlign:"center"}}>No data for this day.</p>;
  const mealsList=Array.isArray(log.meals)?log.meals:[];
  const displayWt=wt||user.weight;
  const bmi=calcBMI(displayWt,user.height_cm),cat=bmiCat(bmi);
  const pts=calcPts(log,user),col=dayColor(log,user);
  const totalCal=mealsList.reduce((s,m)=>s+(m.nutrition?.calories||0),0);
  const totalPro=mealsList.reduce((s,m)=>s+(m.nutrition?.protein||0),0);
  const totalCarb=mealsList.reduce((s,m)=>s+(m.nutrition?.carbs||0),0);
  const totalFat=mealsList.reduce((s,m)=>s+(m.nutrition?.fats||0),0);
  return(
    <div style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"1rem",flexWrap:"wrap"}}>
        <Tag color={col||"#888"}>{col==="#22c55e"?"Great Day":col==="#fbbf24"?"Good Day":"Needs Work"}</Tag>
        <Tag color="#fbbf24">{pts} pts</Tag>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginBottom:12}}>
        {[["⚖️",displayWt+"kg","Weight","#60a5fa"],["📊",bmi+" ("+cat.label+")","BMI",cat.c],["💧",(log.water||0)+" gl","Water","#38bdf8"],["😴",(log.sleep||0)+"h","Sleep","#a78bfa"],["😊",log.mood||"—","Mood","#22c55e"]].map(([icon,val,label,color])=>(
          <Card key={label} style={{padding:"0.8rem",textAlign:"center"}}><div style={{fontSize:18,marginBottom:2}}>{icon}</div><div style={{color,fontWeight:700,fontSize:13}}>{val}</div><div style={{color:"rgba(255,255,255,0.3)",fontSize:10}}>{label}</div></Card>
        ))}
      </div>
      <Card style={{marginBottom:10}}>
        <p style={STITLE}>📊 Nutrition vs Target</p>
        {mealsList.length===0||totalCal===0?<p style={{color:"rgba(255,255,255,0.3)",fontSize:12,textAlign:"center",padding:"0.5rem 0"}}>No meals logged.</p>:(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
              {[["🔥 Cal",totalCal,tCal,"kcal","#fbbf24"],["💪 Pro",totalPro,tPro,"g","#60a5fa"],["🌾 Carbs",totalCarb,tCar,"g","#34d399"],["🥑 Fats",totalFat,tFat,"g","#f97316"]].map(([label,val,tgt,unit,color])=>(
                <div key={label} style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"0.65rem 0.4rem",textAlign:"center"}}>
                  <div style={{color:"rgba(255,255,255,0.38)",fontSize:10,marginBottom:2}}>{label}</div>
                  <div style={{color,fontWeight:700,fontSize:17}}>{val}<span style={{fontSize:10,fontWeight:400}}>{unit}</span></div>
                  <div style={{color:"rgba(255,255,255,0.22)",fontSize:10}}>/ {tgt}{unit}</div>
                  <div style={{height:3,background:"rgba(255,255,255,0.07)",borderRadius:2,marginTop:4}}><div style={{height:3,background:color,borderRadius:2,width:Math.min(100,tgt>0?Math.round(val/tgt*100):0)+"%"}}/></div>
                </div>
              ))}
            </div>
            <p style={{...STITLE,marginBottom:8}}>📋 Meal Breakdown</p>
            <div style={{display:"grid",gap:8}}>
              {mealsList.map((meal,i)=>(
                <div key={i} style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:10,padding:"0.75rem 1rem"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <span style={{color:"#fbbf24",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.8}}>Meal {i+1}</span>
                      <p style={{color:"rgba(255,255,255,0.7)",fontSize:12,marginTop:1}}>{meal.description}</p>
                    </div>
                    <div style={{textAlign:"right",paddingLeft:8,flexShrink:0}}>
                      <div style={{color:"#fbbf24",fontWeight:700,fontSize:14}}>{meal.nutrition?.calories||0}<span style={{fontSize:10,fontWeight:400}}> kcal</span></div>
                      <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                        <span style={{color:"#60a5fa",fontSize:11}}>P:{meal.nutrition?.protein||0}g</span>
                        <span style={{color:"#34d399",fontSize:11}}>C:{meal.nutrition?.carbs||0}g</span>
                        <span style={{color:"#f97316",fontSize:11}}>F:{meal.nutrition?.fats||0}g</span>
                      </div>
                    </div>
                  </div>
                  {meal.nutrition?.items&&meal.nutrition.items.length>0&&(
                    <div style={{paddingLeft:8,borderLeft:"2px solid rgba(255,255,255,0.07)",marginTop:4}}>
                      {meal.nutrition.items.map((item,j)=>(
                        <div key={j} style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}>
                          <span style={{color:"rgba(255,255,255,0.4)",fontSize:11}}>{item.name}</span>
                          <span style={{color:"rgba(251,191,36,0.7)",fontSize:11}}>{item.calories}cal · P:{item.protein}g</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
      {log.exercise&&<Card style={{marginBottom:10}}><p style={STITLE}>🏋️ Exercise</p><p style={{color:"rgba(255,255,255,0.55)",fontSize:13,lineHeight:1.6}}>{log.exercise}</p></Card>}
      {log.report&&<Card style={{border:"1px solid rgba(251,191,36,0.15)"}}><p style={{color:"#fbbf24",fontSize:12,fontWeight:600,marginBottom:8}}>🤖 AI Coach Report</p><div style={{color:"rgba(255,255,255,0.65)",fontSize:13,lineHeight:1.85,whiteSpace:"pre-wrap"}}>{log.report}</div></Card>}
    </div>
  );
}

// LOG TAB
function LogTab({currentUser,user,tCal,tPro,tCar,tFat,streak,today,onSaved}){
  const[ready,setReady]=useState(false);
  const[meals,setMeals]=useState([]);
  const[newMeal,setNewMeal]=useState("");
  const[exercise,setExercise]=useState("");
  const[water,setWater]=useState(4);
  const[sleep,setSleep]=useState(7);
  const[mood,setMood]=useState("Good");
  const[notes,setNotes]=useState("");
  const[saving,setSaving]=useState(false);
  const[saved,setSaved]=useState(false);
  const[todayWt,setTodayWt]=useState("");
  const[wtSaved,setWtSaved]=useState(false);
  const[waist,setWaist]=useState("");
  const[chest,setChest]=useState("");
  const[hips,setHips]=useState("");
  const[mSaved,setMSaved]=useState(false);
  const[notifTime,setNotifTime]=useState("");
  const[notifSaved,setNotifSaved]=useState(false);
  const wk=weekStart();

  useEffect(()=>{
    async function load(){
      const[log,wt,meas,nt]=await Promise.all([dbGetLog(currentUser.id,today),dbGetWeight(currentUser.id,today),dbGetMeasurement(currentUser.id,wk),dbGetNotifTime(currentUser.id)]);
      if(log){setMeals(Array.isArray(log.meals)?log.meals:[]);setExercise(log.exercise||"");setWater(log.water||4);setSleep(log.sleep||7);setMood(log.mood||"Good");setNotes(log.notes||"");setSaved(true);}
      if(wt){setTodayWt(String(wt));setWtSaved(true);}
      if(meas){setWaist(String(meas.waist||""));setChest(String(meas.chest||""));setHips(String(meas.hips||""));setMSaved(true);}
      if(nt){setNotifTime(nt);setNotifSaved(true);}
      setReady(true);
    }
    load();
  },[currentUser.id,today,wk]);

  useEffect(()=>{if(!notifTime)return;const iv=setInterval(()=>checkNotif(currentUser.id,notifTime),10000);return()=>clearInterval(iv);},[notifTime,currentUser.id]);

  async function persistMeals(updated){await dbSaveLog(currentUser.id,today,{meals:updated,exercise,water,sleep,mood,notes});onSaved();}
  async function addMeal(){
    if(!newMeal.trim())return;
    const meal={description:newMeal.trim(),nutrition:null,estimating:true};
    const updated=[...meals,meal];setMeals(updated);setNewMeal("");setSaved(false);
    const idx=updated.length-1;
    try{const n=await estimateMealNutrition(meal.description);const withN=updated.map((m,i)=>i===idx?{...m,nutrition:n,estimating:false}:m);setMeals(withN);await persistMeals(withN);}
    catch{const failed=updated.map((m,i)=>i===idx?{...m,estimating:false,error:true}:m);setMeals(failed);}
  }
  async function removeMeal(idx){const updated=meals.filter((_,i)=>i!==idx);setMeals(updated);await persistMeals(updated);}
  async function saveWt(){if(!todayWt)return;await dbSaveWeight(currentUser.id,today,+todayWt);setWtSaved(true);onSaved();}
  async function saveMeas(){if(!waist&&!chest&&!hips)return;await dbSaveMeasurement(currentUser.id,wk,{waist:+waist,chest:+chest,hips:+hips});setMSaved(true);onSaved();}
  async function saveNotif(){if(!notifTime)return;if("Notification"in window&&Notification.permission!=="granted")await Notification.requestPermission();await dbSaveNotifTime(currentUser.id,notifTime);setNotifSaved(true);}
  async function saveLog(){
    setSaving(true);
    const readyMeals=meals.filter(m=>!m.estimating);
    const logData={meals:readyMeals,exercise,water,sleep,mood,notes};
    try{logData.report=await generateReport(user,readyMeals,exercise,water,sleep,mood,notes,tCal,tPro,tCar,tFat,streak);}
    catch(e){logData.report="Report unavailable — "+e.message;}
    await dbSaveLog(currentUser.id,today,logData);
    setSaved(true);setSaving(false);onSaved();
  }

  const totalCal=meals.reduce((s,m)=>s+(m.nutrition?.calories||0),0);
  const totalPro=meals.reduce((s,m)=>s+(m.nutrition?.protein||0),0);
  const totalCarb=meals.reduce((s,m)=>s+(m.nutrition?.carbs||0),0);
  const totalFat=meals.reduce((s,m)=>s+(m.nutrition?.fats||0),0);

  if(!ready)return<div style={{display:"flex",justifyContent:"center",padding:"3rem"}}><Spin/></div>;

  return(
    <div style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.1rem"}}>
        <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:21}}>Today — {today}</h2>
        {saved&&<Tag color="#22c55e">✓ Logged</Tag>}
      </div>
      <div style={SEC}>
        <p style={STITLE}>⚖️ Today's Weight</p>
        <div style={{display:"flex",gap:9,alignItems:"center"}}>
          <input type="number" placeholder="e.g. 94.5" value={todayWt} onChange={e=>{setTodayWt(e.target.value);setWtSaved(false);}} style={{...IS,flex:1}}/>
          <span style={{color:"rgba(255,255,255,0.35)",fontSize:13}}>kg</span>
          <button onClick={saveWt} style={{padding:"9px 14px",borderRadius:9,border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600,fontSize:13,whiteSpace:"nowrap",background:wtSaved?"rgba(255,255,255,0.05)":"linear-gradient(135deg,#22c55e,#16a34a)",color:wtSaved?"rgba(255,255,255,0.65)":"#fff"}}>{wtSaved?"✓ Saved":"Save"}</button>
        </div>
        <p style={{color:"rgba(255,255,255,0.25)",fontSize:11,marginTop:6}}>Weigh first thing in the morning for accuracy</p>
      </div>
      <div style={SEC}>
        <p style={STITLE}>📏 Weekly Measurements (inches) — week of {wk}</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:9,marginBottom:10}}>
          <div><label style={LBL}>Waist (in)</label><input type="number" step="0.1" placeholder="e.g. 34" value={waist} onChange={e=>{setWaist(e.target.value);setMSaved(false);}} style={IS}/></div>
          <div><label style={LBL}>Chest (in)</label><input type="number" step="0.1" placeholder="e.g. 40" value={chest} onChange={e=>{setChest(e.target.value);setMSaved(false);}} style={IS}/></div>
          <div><label style={LBL}>Hips (in)</label><input type="number" step="0.1" placeholder="e.g. 38" value={hips} onChange={e=>{setHips(e.target.value);setMSaved(false);}} style={IS}/></div>
        </div>
        <button onClick={saveMeas} style={{padding:"8px 14px",borderRadius:9,border:mSaved?"1px solid rgba(255,255,255,0.1)":"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:12,background:mSaved?"rgba(255,255,255,0.05)":"linear-gradient(135deg,#fbbf24,#f59e0b)",color:mSaved?"rgba(255,255,255,0.65)":"#0d1a00"}}>{mSaved?"✓ Measurements Saved":"Save Measurements"}</button>
      </div>
      <div style={SEC}>
        <p style={STITLE}>🍽️ Meals Today</p>
        <p style={{color:"rgba(255,255,255,0.28)",fontSize:11,marginBottom:10}}>Add each meal separately — AI estimates nutrition instantly</p>
        {meals.length>0&&(
          <div style={{marginBottom:12,display:"grid",gap:8}}>
            {meals.map((meal,i)=>(
              <div key={i} style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,padding:"0.75rem 1rem"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}><span style={{color:"#fbbf24",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:0.8}}>Meal {i+1}</span><p style={{color:"rgba(255,255,255,0.8)",fontSize:13,marginTop:2,lineHeight:1.4}}>{meal.description}</p></div>
                  <button onClick={()=>removeMeal(i)} style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.25)",cursor:"pointer",fontSize:16,padding:"0 0 0 10px"}}>✕</button>
                </div>
                {meal.estimating&&<div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}><Spin s={12}/><span style={{color:"rgba(255,255,255,0.4)",fontSize:11}}>Estimating nutrition...</span></div>}
                {meal.error&&<p style={{color:"#f87171",fontSize:11,marginTop:4}}>⚠ Could not estimate — check connection</p>}
                {meal.nutrition&&!meal.estimating&&(
                  <div style={{marginTop:6}}>
                    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:4}}>
                      <span style={{color:"#fbbf24",fontSize:12,fontWeight:600}}>{meal.nutrition.calories} kcal</span>
                      <span style={{color:"#60a5fa",fontSize:12}}>P: {meal.nutrition.protein}g</span>
                      <span style={{color:"#34d399",fontSize:12}}>C: {meal.nutrition.carbs}g</span>
                      <span style={{color:"#f97316",fontSize:12}}>F: {meal.nutrition.fats}g</span>
                    </div>
                    {meal.nutrition.items&&meal.nutrition.items.length>0&&(
                      <div style={{paddingLeft:8,borderLeft:"2px solid rgba(255,255,255,0.07)"}}>
                        {meal.nutrition.items.map((item,j)=><div key={j} style={{display:"flex",justifyContent:"space-between",padding:"2px 0"}}><span style={{color:"rgba(255,255,255,0.45)",fontSize:11}}>{item.name}</span><span style={{color:"rgba(251,191,36,0.7)",fontSize:11}}>{item.calories}cal · P:{item.protein}g</span></div>)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {meals.length>0&&totalCal>0&&(
          <div style={{background:"rgba(251,191,36,0.06)",border:"1px solid rgba(251,191,36,0.15)",borderRadius:9,padding:"0.7rem 1rem",marginBottom:10}}>
            <p style={{color:"rgba(255,255,255,0.5)",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:0.8,marginBottom:6}}>Daily Total ({meals.length} meals)</p>
            <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
              <span style={{color:"#fbbf24",fontWeight:700,fontSize:14}}>{totalCal}<span style={{fontSize:11,fontWeight:400}}> / {tCal} kcal</span></span>
              <span style={{color:"#60a5fa",fontWeight:700,fontSize:14}}>{totalPro}g<span style={{fontSize:11,fontWeight:400}}> / {tPro}g protein</span></span>
              <span style={{color:"#34d399",fontWeight:700,fontSize:14}}>{totalCarb}g<span style={{fontSize:11,fontWeight:400}}> / {tCar}g carbs</span></span>
              <span style={{color:"#f97316",fontWeight:700,fontSize:14}}>{totalFat}g<span style={{fontSize:11,fontWeight:400}}> / {tFat}g fats</span></span>
            </div>
            <div style={{height:4,background:"rgba(255,255,255,0.07)",borderRadius:2,marginTop:8}}><div style={{height:4,background:"linear-gradient(90deg,#fbbf24,#f59e0b)",borderRadius:2,width:Math.min(100,Math.round(totalCal/tCal*100))+"%"}}/></div>
          </div>
        )}
        <div style={{display:"flex",gap:8}}>
          <input value={newMeal} onChange={e=>setNewMeal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addMeal()} placeholder="e.g. 2 rotis with dal and sabzi, chai..." style={{...IS,flex:1}}/>
          <button onClick={addMeal} disabled={!newMeal.trim()} style={{padding:"10px 16px",borderRadius:9,border:"none",cursor:newMeal.trim()?"pointer":"not-allowed",fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:13,background:newMeal.trim()?"linear-gradient(135deg,#fbbf24,#f59e0b)":"rgba(255,255,255,0.07)",color:newMeal.trim()?"#0d1a00":"rgba(255,255,255,0.3)",whiteSpace:"nowrap"}}>+ Add Meal</button>
        </div>
        <p style={{color:"rgba(255,255,255,0.2)",fontSize:11,marginTop:5}}>Press Enter or click + Add Meal · AI estimates nutrition automatically</p>
      </div>
      <div style={SEC}>
        <p style={STITLE}>🏋️ Exercise Today</p>
        <textarea value={exercise} onChange={e=>{setExercise(e.target.value);setSaved(false);}} placeholder="e.g. 45 min gym — chest + triceps. Bench press 4x10, cable flyes, 15 min incline walk..." style={{...TS,minHeight:70}}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div style={{...CARD,padding:"1rem 1.2rem"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{color:"rgba(255,255,255,0.6)",fontSize:13}}>💧 Water</span><span style={{color:"#38bdf8",fontWeight:700,fontSize:16}}>{water}<span style={{fontSize:11}}> gl</span></span></div><input type="range" min={0} max={16} value={water} onChange={e=>{setWater(+e.target.value);setSaved(false);}} style={{width:"100%",accentColor:"#38bdf8"}}/></div>
        <div style={{...CARD,padding:"1rem 1.2rem"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}><span style={{color:"rgba(255,255,255,0.6)",fontSize:13}}>😴 Sleep</span><span style={{color:"#a78bfa",fontWeight:700,fontSize:16}}>{sleep}<span style={{fontSize:11}}> hrs</span></span></div><input type="range" min={0} max={12} value={sleep} onChange={e=>{setSleep(+e.target.value);setSaved(false);}} style={{width:"100%",accentColor:"#a78bfa"}}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div style={{...CARD,padding:"1rem 1.2rem"}}><label style={LBL}>😊 Mood</label><select value={mood} onChange={e=>{setMood(e.target.value);setSaved(false);}} style={SS}>{MOODS.map(m=><option key={m} value={m}>{m}</option>)}</select></div>
        <div style={{...CARD,padding:"1rem 1.2rem"}}><label style={LBL}>📝 Notes</label><input value={notes} onChange={e=>{setNotes(e.target.value);setSaved(false);}} placeholder="Anything else..." style={IS}/></div>
      </div>
      <div style={SEC}>
        <p style={STITLE}>🔔 Daily Weight Reminder</p>
        <div style={{display:"flex",gap:9,alignItems:"center"}}>
          <input type="time" value={notifTime} onChange={e=>{setNotifTime(e.target.value);setNotifSaved(false);}} style={{...IS,flex:1}}/>
          <button onClick={saveNotif} style={{padding:"9px 14px",borderRadius:9,border:notifSaved?"1px solid rgba(255,255,255,0.1)":"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600,fontSize:13,whiteSpace:"nowrap",background:notifSaved?"rgba(255,255,255,0.05)":"linear-gradient(135deg,#fbbf24,#f59e0b)",color:notifSaved?"rgba(255,255,255,0.65)":"#0d1a00"}}>{notifSaved?"✓ Set":"Set Reminder"}</button>
        </div>
      </div>
      <button onClick={saveLog} disabled={saving} style={{width:"100%",padding:"13px",fontSize:15,fontFamily:"'DM Sans',sans-serif",fontWeight:700,border:"none",borderRadius:12,cursor:saving?"not-allowed":"pointer",background:saving?"rgba(251,191,36,0.35)":"linear-gradient(135deg,#fbbf24,#f59e0b)",color:"#0d1a00",opacity:saving?0.7:1}}>
        {saving?"⏳ Generating AI Coach Report...":saved?"✅ Saved! Update Log":"💾 Save Log & Generate AI Report →"}
      </button>
      {saved&&!saving&&<p style={{color:"#22c55e",textAlign:"center",marginTop:9,fontSize:13}}>✅ Saved! Switch to Reports tab to see your AI health report.</p>}
    </div>
  );
}

// REPORT TAB
function ReportTab({currentUser,user,tCal,tPro,tCar,tFat}){
  const[logs,setLogs]=useState([]);
  const[weights,setWeights]=useState({});
  const[sel,setSel]=useState(todayStr());
  const[selLog,setSelLog]=useState(null);
  const[selWt,setSelWt]=useState(null);
  const[loading,setLoading]=useState(true);
  useEffect(()=>{
    async function load(){
      const[allLogs,allWts]=await Promise.all([dbGetAllLogs(currentUser.id),dbGetAllWeights(currentUser.id)]);
      setLogs(allLogs);const wtMap={};allWts.forEach(w=>{wtMap[w.date]=w.weight;});setWeights(wtMap);
      const todayLog=allLogs.find(l=>l.date===todayStr());
      if(todayLog){setSelLog(todayLog);setSelWt(wtMap[todayStr()]||null);}
      setLoading(false);
    }
    load();
  },[currentUser.id]);
  function handleSelect(date){setSel(date);setSelLog(logs.find(l=>l.date===date)||null);setSelWt(weights[date]||null);}
  if(loading)return<div style={{display:"flex",justifyContent:"center",padding:"3rem"}}><Spin/></div>;
  return(
    <div style={{animation:"fadeUp 0.3s ease"}}>
      <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",marginBottom:"1rem",fontSize:21}}>📊 My Reports</h2>
      <Card style={{marginBottom:14}}><CalView logs={logs} user={user} onSelect={handleSelect} selected={sel}/></Card>
      {sel&&(selLog?<DayReport log={selLog} user={user} wt={selWt} tCal={tCal} tPro={tPro} tCar={tCar} tFat={tFat}/>:<Card style={{padding:"1.5rem",textAlign:"center"}}><p style={{color:"rgba(255,255,255,0.3)"}}>{sel>todayStr()?"Future date.":"No log for this date."}</p></Card>)}
    </div>
  );
}

// CHALLENGES TAB
function ChallengesTab({currentUser,user}){
  const[challenges,setChallenges]=useState([]);
  const[loading,setLoading]=useState(true);
  const[view,setView]=useState("list");
  const[selected,setSelected]=useState(null);
  const[members,setMembers]=useState([]);
  const[membersLb,setMembersLb]=useState([]);
  const[membersLoading,setMembersLoading]=useState(false);
  const[joinCode,setJoinCode]=useState("");
  const[joinErr,setJoinErr]=useState("");
  const[joinLoading,setJoinLoading]=useState(false);
  const[form,setForm]=useState({title:"",description:"",goal_type:"most_points",start_date:todayStr(),end_date:"",is_public:true});
  const[createLoading,setCreateLoading]=useState(false);
  const[createErr,setCreateErr]=useState("");
  const F=(k,v)=>setForm(p=>({...p,[k]:v}));
  const load=useCallback(async()=>{setLoading(true);const c=await dbGetMyChallenges(currentUser.id);setChallenges(c);setLoading(false);},[currentUser.id]);
  useEffect(()=>{load();},[load]);

  async function handleJoin(){
    if(!joinCode.trim())return;setJoinLoading(true);setJoinErr("");
    try{const challenge=await dbGetChallengeByCode(joinCode.trim());if(!challenge){setJoinErr("Invalid code.");setJoinLoading(false);return;}await dbJoinChallenge(challenge.id,currentUser.id);await load();setView("list");setJoinCode("");}
    catch(e){setJoinErr(e.message);}setJoinLoading(false);
  }
  async function handleCreate(){
    if(!form.title||!form.end_date){setCreateErr("Fill title and end date.");return;}
    setCreateLoading(true);setCreateErr("");
    try{
      let code,attempts=0;
      while(attempts<10){code=genCode(6);const existing=await dbGetChallengeByCode(code);if(!existing)break;attempts++;}
      const challenge=await dbCreateChallenge({creator_id:currentUser.id,community_id:user.community_id||null,title:form.title,description:form.description,goal_type:form.goal_type,start_date:form.start_date,end_date:form.end_date,join_code:code,is_public:form.is_public});
      await dbJoinChallenge(challenge.id,currentUser.id);await load();setView("list");
    }catch(e){setCreateErr(e.message);}setCreateLoading(false);
  }
  async function openDetail(challenge){
    setSelected(challenge);setView("detail");setMembersLoading(true);
    const m=await dbGetChallengeMembers(challenge.id);
    setMembers(m);
    // Build leaderboard based on goal type
    const userProfiles=m.map(cm=>cm.profiles).filter(Boolean);
    const pts=await dbGetWeeklyPoints(userProfiles,challenge.start_date);
    // For each member, fetch all logs within challenge window to sum points
    const logPromises=userProfiles.map(async u=>{
      const{data}=await supabase.from("daily_logs").select("meals,exercise,water,sleep").gte("date",challenge.start_date).lte("date",challenge.end_date).eq("user_id",u.id);
      return{userId:u.id,logs:data||[]};
    });
    const allLogs=await Promise.all(logPromises);
    // Calculate score per goal type
    const scored=m.map(cm=>{
      const profile=cm.profiles;
      if(!profile)return{...cm,score:0,scoreLabel:"0"};
      const userLogs=allLogs.find(l=>l.userId===profile.id)?.logs||[];
      let score=0,label="0";
      if(challenge.goal_type==="most_points"){
        score=userLogs.reduce((s,l)=>s+calcPts(l,profile),0);
        label=score+" pts";
      } else if(challenge.goal_type==="most_workouts"){
        score=userLogs.filter(l=>l.exercise&&l.exercise.trim().length>3).length;
        label=score+" workouts";
      } else if(challenge.goal_type==="longest_streak"){
        // count consecutive days with logs
        score=userLogs.length;
        label=score+" days logged";
      } else if(challenge.goal_type==="weight_loss"){
        // needs weight logs — use points as fallback
        score=userLogs.reduce((s,l)=>s+calcPts(l,profile),0);
        label=score+" pts";
      }
      return{...cm,score,scoreLabel:label};
    }).sort((a,b)=>b.score-a.score);
    setMembersLb(scored);
    setMembersLoading(false);
  }

  const BackBtn=({to})=><button onClick={()=>setView(to)} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.45)",borderRadius:7,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>← Back</button>;

  return(
    <div style={{animation:"fadeUp 0.3s ease"}}>
      {view==="list"&&<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.1rem"}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:21}}>⚔️ Challenges</h2>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="ghost" onClick={()=>setView("join")} style={{fontSize:12,padding:"6px 12px"}}>Join</Btn>
            <Btn onClick={()=>setView("create")} style={{fontSize:12,padding:"6px 12px"}}>+ Create</Btn>
          </div>
        </div>
        {loading?<div style={{display:"flex",justifyContent:"center",padding:"2rem"}}><Spin/></div>:(
          <>
            {challenges.length===0&&<Card style={{padding:"2rem",textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>🏆</div><p style={{color:"rgba(255,255,255,0.5)",marginBottom:16}}>No challenges yet. Create one or join with a code!</p><div style={{display:"flex",gap:10,justifyContent:"center"}}><Btn variant="ghost" onClick={()=>setView("join")}>Join a Challenge</Btn><Btn onClick={()=>setView("create")}>Create Challenge</Btn></div></Card>}
            <div style={{display:"grid",gap:10}}>
              {challenges.map(c=>{
                const isActive=todayStr()>=c.start_date&&todayStr()<=c.end_date,isEnded=todayStr()>c.end_date;
                return<Card key={c.id} style={{cursor:"pointer"}} onClick={()=>openDetail(c)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                    <div><div style={{fontWeight:600,fontSize:15}}>{c.title}</div><div style={{color:"rgba(255,255,255,0.4)",fontSize:12,marginTop:2}}>{c.description}</div></div>
                    <Tag color={isEnded?"#ef4444":isActive?"#22c55e":"#fbbf24"}>{isEnded?"Ended":isActive?"Active":"Upcoming"}</Tag>
                  </div>
                  <div style={{display:"flex",gap:12,fontSize:12,color:"rgba(255,255,255,0.38)"}}>
                    <span>📅 {c.start_date} → {c.end_date}</span><span>🎯 {GOAL_TYPES.find(g=>g.value===c.goal_type)?.label}</span>
                  </div>
                  <div style={{marginTop:8,display:"flex",gap:8,alignItems:"center"}}>
                    <div style={{background:"rgba(255,255,255,0.06)",borderRadius:6,padding:"3px 10px",fontSize:12,fontFamily:"monospace",color:"#fbbf24",letterSpacing:2}}>{c.join_code}</div>
                    <span style={{color:"rgba(255,255,255,0.3)",fontSize:11}}>Share this code to invite friends</span>
                  </div>
                </Card>;
              })}
            </div>
          </>
        )}
      </>}
      {view==="join"&&<>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1.1rem"}}><BackBtn to="list"/><h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:21}}>Join a Challenge</h2></div>
        <Card>
          <p style={{color:"rgba(255,255,255,0.5)",fontSize:13,marginBottom:16,lineHeight:1.6}}>Enter the 6-character code shared by the challenge creator.</p>
          <label style={LBL}>Challenge Code</label>
          <input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase())} placeholder="e.g. FIT3X9" onKeyDown={e=>e.key==="Enter"&&handleJoin()} style={{...IS,textTransform:"uppercase",letterSpacing:4,fontSize:20,textAlign:"center",marginBottom:12}}/>
          {joinErr&&<p style={{color:"#f87171",fontSize:13,marginBottom:12,textAlign:"center"}}>{joinErr}</p>}
          <Btn onClick={handleJoin} disabled={joinLoading||!joinCode.trim()} style={{width:"100%",padding:"12px"}}>{joinLoading?"Joining...":"Join Challenge →"}</Btn>
        </Card>
      </>}
      {view==="create"&&<>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1.1rem"}}><BackBtn to="list"/><h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:21}}>Create Challenge</h2></div>
        <Card>
          <FInput label="Challenge Title" value={form.title} onChange={e=>F("title",e.target.value)} placeholder="e.g. January Fat Loss Challenge"/>
          <div style={{marginBottom:12}}><label style={LBL}>Description (optional)</label><textarea value={form.description} onChange={e=>F("description",e.target.value)} placeholder="What's this challenge about?" style={{...TS,minHeight:60}}/></div>
          <FSelect label="Goal Type" value={form.goal_type} onChange={e=>F("goal_type",e.target.value)}>{GOAL_TYPES.map(g=><option key={g.value} value={g.value}>{g.label}</option>)}</FSelect>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div><label style={LBL}>Start Date</label><input type="date" value={form.start_date} onChange={e=>F("start_date",e.target.value)} style={IS}/></div>
            <div><label style={LBL}>End Date</label><input type="date" value={form.end_date} onChange={e=>F("end_date",e.target.value)} style={IS}/></div>
          </div>
          <div style={{marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
            <input type="checkbox" checked={form.is_public} onChange={e=>F("is_public",e.target.checked)} style={{accentColor:"#fbbf24",width:16,height:16}}/>
            <span style={{color:"rgba(255,255,255,0.6)",fontSize:13}}>Make this challenge public (anyone with code can join)</span>
          </div>
          {createErr&&<p style={{color:"#f87171",fontSize:13,marginBottom:12,textAlign:"center"}}>{createErr}</p>}
          <Btn onClick={handleCreate} disabled={createLoading} style={{width:"100%",padding:"12px"}}>{createLoading?"Creating...":"Create Challenge 🏆"}</Btn>
        </Card>
      </>}
      {view==="detail"&&selected&&<>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1.1rem"}}><BackBtn to="list"/><h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:20}}>{selected.title}</h2></div>
        {/* Challenge Info Card */}
        <Card style={{marginBottom:12}}>
          {selected.description&&<p style={{color:"rgba(255,255,255,0.55)",fontSize:13,marginBottom:10}}>{selected.description}</p>}
          <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:12,color:"rgba(255,255,255,0.4)",marginBottom:12}}>
            <span>📅 {selected.start_date} → {selected.end_date}</span>
            <span>🎯 {GOAL_TYPES.find(g=>g.value===selected.goal_type)?.label}</span>
            <span>👤 Created by {selected.profiles?.name||selected.creator_id}</span>
            <span>👥 {members.length} member{members.length!==1?"s":""}</span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"rgba(251,191,36,0.06)",borderRadius:9,border:"1px solid rgba(251,191,36,0.15)"}}>
            <div>
              <div style={{color:"rgba(255,255,255,0.45)",fontSize:11,marginBottom:2}}>Invite others with this code</div>
              <div style={{fontSize:22,fontFamily:"monospace",color:"#fbbf24",letterSpacing:5,fontWeight:700}}>{selected.join_code}</div>
            </div>
          </div>
        </Card>
        {/* Leaderboard */}
        <h3 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:17,marginBottom:10}}>🏆 Leaderboard</h3>
        {membersLoading?<div style={{display:"flex",justifyContent:"center",padding:"2rem"}}><Spin/></div>:(
          membersLb.length===0?<Card style={{padding:"1.5rem",textAlign:"center"}}><p style={{color:"rgba(255,255,255,0.3)"}}>No members yet. Share the code!</p></Card>:(
            <div style={{display:"grid",gap:9}}>
              {membersLb.map((m,i)=>{
                const isMe=m.user_id===currentUser.id;
                const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":null;
                return(
                  <Card key={m.id} style={{display:"flex",alignItems:"center",gap:12,border:isMe?"1px solid rgba(251,191,36,0.25)":"1px solid rgba(255,255,255,0.07)",background:isMe?"rgba(251,191,36,0.03)":"rgba(255,255,255,0.035)"}}>
                    <div style={{fontSize:medal?22:14,minWidth:32,textAlign:"center",fontWeight:700,color:"rgba(255,255,255,0.4)"}}>
                      {medal||`#${i+1}`}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:600,fontSize:14,display:"flex",alignItems:"center",gap:6}}>
                        {m.profiles?.name||m.user_id}
                        {isMe&&<Tag color="#fbbf24">You</Tag>}
                      </div>
                      <div style={{color:"rgba(255,255,255,0.35)",fontSize:12,marginTop:2}}>{m.profiles?.goal||"—"}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{color:i===0?"#fbbf24":i===1?"#94a3b8":i===2?"#d97706":"rgba(255,255,255,0.6)",fontWeight:700,fontSize:16}}>{m.scoreLabel}</div>
                      <div style={{color:"rgba(255,255,255,0.25)",fontSize:10,marginTop:1}}>{GOAL_TYPES.find(g=>g.value===selected.goal_type)?.label}</div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )
        )}
      </>}
    </div>
  );
}

// PUBLIC PROFILE MODAL
function PublicProfileModal({userId,onClose}){
  const[profile,setProfile]=useState(null);
  const[stats,setStats]=useState({streak:0,weightChange:null,weekPts:0});
  const[loading,setLoading]=useState(true);
  useEffect(()=>{
    async function load(){
      const p=await dbGetPublicProfile(userId);
      setProfile(p);
      if(p){
        const wk=weekStart();
        const[streak,wc,pts]=await Promise.all([
          dbGetUserStreak(userId),
          dbGetUserWeightChange(userId),
          dbGetWeeklyPoints([p],wk),
        ]);
        setStats({streak,weightChange:wc,weekPts:pts[userId]||0});
      }
      setLoading(false);
    }
    load();
  },[userId]);
  const vis=profile?.profile_visible||{};
  const bmi=profile?calcBMI(profile.weight,profile.height_cm):null;
  const bmiI=bmi?bmiCat(bmi):null;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:"1rem"}} onClick={onClose}>
      <Card style={{width:380,maxWidth:"100%",padding:"1.5rem",animation:"fadeUp 0.2s ease",border:"1px solid rgba(251,191,36,0.2)",maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        {loading?<div style={{display:"flex",justifyContent:"center",padding:"2rem"}}><Spin/></div>:!profile?
          <div style={{textAlign:"center",padding:"1rem"}}><p style={{color:"rgba(255,255,255,0.4)"}}>Profile not public or not found.</p><Btn variant="ghost" onClick={onClose} style={{marginTop:12}}>Close</Btn></div>:
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
              <div>
                <div style={{fontFamily:"'Playfair Display',serif",color:"#fff",fontSize:20,fontWeight:700}}>{profile.name}</div>
                <div style={{color:"rgba(255,255,255,0.4)",fontSize:13}}>@{profile.id}</div>
                {profile.communities?.name&&<div style={{marginTop:4}}><Tag color="#a78bfa">{profile.communities.logo_emoji} {profile.communities.name}</Tag></div>}
              </div>
              <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.35)",cursor:"pointer",fontSize:20,lineHeight:1}}>✕</button>
            </div>
            {profile.bio&&<p style={{color:"rgba(255,255,255,0.5)",fontSize:13,lineHeight:1.6,marginBottom:14,padding:"10px 12px",background:"rgba(255,255,255,0.04)",borderRadius:8}}>{profile.bio}</p>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
              <div style={{background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"10px 12px"}}>
                <div style={{color:"rgba(255,255,255,0.35)",fontSize:10,marginBottom:2}}>🎯 Goal</div>
                <div style={{color:"#fff",fontWeight:600,fontSize:13}}>{profile.goal}</div>
              </div>
              <div style={{background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"10px 12px"}}>
                <div style={{color:"rgba(255,255,255,0.35)",fontSize:10,marginBottom:2}}>⚡ This Week</div>
                <div style={{color:"#fbbf24",fontWeight:600,fontSize:13}}>{stats.weekPts} pts</div>
              </div>
              {vis.streak&&<div style={{background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"10px 12px"}}>
                <div style={{color:"rgba(255,255,255,0.35)",fontSize:10,marginBottom:2}}>🔥 Streak</div>
                <div style={{color:"#f97316",fontWeight:600,fontSize:13}}>{stats.streak} days</div>
              </div>}
              {vis.weight&&<div style={{background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"10px 12px"}}>
                <div style={{color:"rgba(255,255,255,0.35)",fontSize:10,marginBottom:2}}>⚖️ Weight</div>
                <div style={{color:"#60a5fa",fontWeight:600,fontSize:13}}>{profile.weight}kg</div>
              </div>}
              {vis.bmi&&bmi&&<div style={{background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"10px 12px"}}>
                <div style={{color:"rgba(255,255,255,0.35)",fontSize:10,marginBottom:2}}>📊 BMI</div>
                <div style={{color:bmiI.c,fontWeight:600,fontSize:13}}>{bmi} {bmiI.label}</div>
              </div>}
              {vis.weight&&stats.weightChange&&<div style={{background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"10px 12px"}}>
                <div style={{color:"rgba(255,255,255,0.35)",fontSize:10,marginBottom:2}}>📉 Weight Change</div>
                <div style={{color:stats.weightChange.change<0?"#22c55e":"#f87171",fontWeight:600,fontSize:13}}>{stats.weightChange.change>0?"+":""}{stats.weightChange.change}kg</div>
              </div>}
            </div>
            <Btn variant="ghost" onClick={onClose} style={{width:"100%"}}>Close</Btn>
          </>
        }
      </Card>
    </div>
  );
}

// SOCIAL TAB
function SocialTab({currentUser,user}){
  const[view,setView]=useState("search");
  const[query,setQuery]=useState("");
  const[results,setResults]=useState([]);
  const[requests,setRequests]=useState([]);
  const[followers,setFollowers]=useState([]);
  const[following,setFollowing]=useState([]);
  const[followStatus,setFollowStatus]=useState({});
  const[loading,setLoading]=useState(false);
  const[reqLoading,setReqLoading]=useState(false);
  const[profileModal,setProfileModal]=useState(null); // userId to show profile for
  const[followerSort,setFollowerSort]=useState("name"); // name | pts
  const[followingSort,setFollowingSort]=useState("name");
  const[followerPts,setFollowerPts]=useState({});
  const[actionLoading,setActionLoading]=useState({});
  const wk=weekStart();

  const loadSocial=useCallback(async()=>{
    const[reqs,frs,fing]=await Promise.all([dbGetFollowRequests(currentUser.id),dbGetFollowers(currentUser.id),dbGetFollowing(currentUser.id)]);
    setRequests(reqs);setFollowers(frs);setFollowing(fing);
    // Fetch weekly points for followers and following
    const allProfiles=[...frs.map(f=>f.profiles),...fing.map(f=>f.profiles)].filter(Boolean);
    const uniqueProfiles=allProfiles.filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i);
    if(uniqueProfiles.length>0){const pts=await dbGetWeeklyPoints(uniqueProfiles,wk);setFollowerPts(pts);}
  },[currentUser.id,wk]);

  useEffect(()=>{loadSocial();},[loadSocial]);

  async function search(){
    if(!query.trim())return;setLoading(true);
    const res=await dbSearchScopedUsers(query.trim(),currentUser.id,user?.community_id||null);
    setResults(res);
    const statusMap={};await Promise.all(res.map(async u=>{statusMap[u.id]=await dbGetFollowStatus(currentUser.id,u.id);}));
    setFollowStatus(statusMap);setLoading(false);
  }

  async function sendFollow(userId){
    await dbSendFollow(currentUser.id,userId);
    setFollowStatus(s=>({...s,[userId]:"pending"}));
  }

  async function acceptRequest(followerId){
    setReqLoading(true);
    await dbAcceptFollow(followerId,currentUser.id);
    await loadSocial();
    setReqLoading(false);
  }

  async function unfollow(followingId){
    setActionLoading(a=>({...a,[followingId]:true}));
    await dbUnfollow(currentUser.id,followingId);
    await loadSocial();
    setActionLoading(a=>({...a,[followingId]:false}));
  }

  async function removeFollower(followerId){
    setActionLoading(a=>({...a,[followerId]:true}));
    await dbUnfollow(followerId,currentUser.id); // remove their follow of me
    await loadSocial();
    setActionLoading(a=>({...a,[followerId]:false}));
  }

  // Sort helpers
  function sortedList(list,sortKey,idField){
    return [...list].sort((a,b)=>{
      if(sortKey==="pts") return (followerPts[b.profiles?.id]||0)-(followerPts[a.profiles?.id]||0);
      return (a.profiles?.name||"").localeCompare(b.profiles?.name||"");
    });
  }

  const tabs=[
    {id:"search",label:"🔍 Search"},
    {id:"requests",label:`📥 Requests${requests.length>0?` (${requests.length})`:""}`},
    {id:"followers",label:`👥 Followers (${followers.length})`},
    {id:"following",label:`➡️ Following (${following.length})`},
  ];

  const SortBar=({value,onChange})=>(
    <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center"}}>
      <span style={{color:"rgba(255,255,255,0.3)",fontSize:11}}>Sort by:</span>
      {[["name","Name"],["pts","Points"]].map(([v,l])=>(
        <button key={v} onClick={()=>onChange(v)} style={{padding:"3px 10px",borderRadius:20,fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",border:value===v?"1px solid rgba(251,191,36,0.4)":"1px solid rgba(255,255,255,0.1)",background:value===v?"rgba(251,191,36,0.1)":"transparent",color:value===v?"#fbbf24":"rgba(255,255,255,0.4)"}}>
          {l}
        </button>
      ))}
    </div>
  );

  return(
    <div style={{animation:"fadeUp 0.3s ease"}}>
      {profileModal&&<PublicProfileModal userId={profileModal} onClose={()=>setProfileModal(null)}/>}
      <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",marginBottom:"1rem",fontSize:21}}>👥 Social</h2>
      <div style={{display:"flex",gap:4,marginBottom:14,overflowX:"auto"}}>
        {tabs.map(t=><button key={t.id} onClick={()=>setView(t.id)} style={{padding:"6px 12px",borderRadius:20,border:view===t.id?"1px solid rgba(251,191,36,0.4)":"1px solid rgba(255,255,255,0.1)",background:view===t.id?"rgba(251,191,36,0.1)":"transparent",color:view===t.id?"#fbbf24":"rgba(255,255,255,0.45)",cursor:"pointer",fontSize:12,fontFamily:"'DM Sans',sans-serif",fontWeight:view===t.id?600:400,whiteSpace:"nowrap"}}>{t.label}</button>)}
      </div>

      {/* SEARCH */}
      {view==="search"&&<>
        <div style={{background:"rgba(255,255,255,0.04)",borderRadius:10,padding:"10px 12px",marginBottom:12}}>
          <p style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>🔒 You can only find people in your <strong style={{color:"rgba(255,255,255,0.6)"}}>community</strong> or <strong style={{color:"rgba(255,255,255,0.6)"}}>shared challenges</strong>.</p>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&search()} placeholder="Search by username..." style={{...IS,flex:1}}/>
          <Btn onClick={search} disabled={loading} style={{whiteSpace:"nowrap"}}>{loading?<Spin s={16}/>:"Search"}</Btn>
        </div>
        <div style={{display:"grid",gap:9}}>
          {results.map(u=>(
            <Card key={u.id} style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1,cursor:"pointer"}} onClick={()=>setProfileModal(u.id)}>
                <div style={{fontWeight:600}}>{u.name} <span style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>@{u.id}</span></div>
                <div style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>{u.goal}{u.communities?.name?` · ${u.communities.name}`:""} <span style={{color:"rgba(251,191,36,0.5)"}}>· view profile →</span></div>
              </div>
              {followStatus[u.id]==="accepted"?<Tag color="#22c55e">Following</Tag>:
               followStatus[u.id]==="pending"?<Tag color="#fbbf24">Requested</Tag>:
               <Btn onClick={()=>sendFollow(u.id)} style={{fontSize:12,padding:"5px 12px"}}>Follow</Btn>}
            </Card>
          ))}
          {results.length===0&&query&&!loading&&<p style={{color:"rgba(255,255,255,0.3)",textAlign:"center",padding:"1rem"}}>No users found in your community or challenges.</p>}
          {results.length===0&&!query&&<p style={{color:"rgba(255,255,255,0.3)",textAlign:"center",padding:"1rem",fontSize:13}}>Search for people by username to connect.</p>}
        </div>
      </>}

      {/* REQUESTS */}
      {view==="requests"&&<div style={{display:"grid",gap:9}}>
        {requests.length===0&&<p style={{color:"rgba(255,255,255,0.3)",textAlign:"center",padding:"1rem"}}>No pending requests.</p>}
        {requests.map(r=>(
          <Card key={r.id} style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{flex:1,cursor:"pointer"}} onClick={()=>setProfileModal(r.follower_id)}>
              <div style={{fontWeight:600}}>{r.profiles?.name}</div>
              <div style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>@{r.follower_id} wants to follow you <span style={{color:"rgba(251,191,36,0.5)"}}>· view profile →</span></div>
            </div>
            <Btn variant="success" onClick={()=>acceptRequest(r.follower_id)} disabled={reqLoading} style={{fontSize:12,padding:"5px 12px"}}>Accept</Btn>
          </Card>
        ))}
      </div>}

      {/* FOLLOWERS */}
      {view==="followers"&&<>
        {followers.length>1&&<SortBar value={followerSort} onChange={setFollowerSort}/>}
        <div style={{display:"grid",gap:9}}>
          {followers.length===0&&<p style={{color:"rgba(255,255,255,0.3)",textAlign:"center",padding:"1rem"}}>No followers yet.</p>}
          {sortedList(followers,followerSort).map(f=>{
            const pid=f.profiles?.id||f.follower_id;
            const pts=followerPts[pid]||0;
            return(
              <Card key={f.id} style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{flex:1,cursor:"pointer"}} onClick={()=>setProfileModal(pid)}>
                  <div style={{fontWeight:600}}>{f.profiles?.name||f.follower_id} <span style={{color:"rgba(255,255,255,0.25)",fontSize:11}}>· view profile →</span></div>
                  <div style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>@{f.follower_id} · {pts} pts this week</div>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <Tag color="#60a5fa">Follower</Tag>
                  <button onClick={()=>removeFollower(f.follower_id)} disabled={actionLoading[f.follower_id]} style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",color:"#f87171",borderRadius:7,padding:"3px 9px",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                    {actionLoading[f.follower_id]?"...":"Remove"}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      </>}

      {/* FOLLOWING */}
      {view==="following"&&<>
        {following.length>1&&<SortBar value={followingSort} onChange={setFollowingSort}/>}
        <div style={{display:"grid",gap:9}}>
          {following.length===0&&<p style={{color:"rgba(255,255,255,0.3)",textAlign:"center",padding:"1rem"}}>Not following anyone yet. Search for users!</p>}
          {sortedList(following,followingSort).map(f=>{
            const pid=f.profiles?.id||f.following_id;
            const pts=followerPts[pid]||0;
            return(
              <Card key={f.id} style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{flex:1,cursor:"pointer"}} onClick={()=>setProfileModal(pid)}>
                  <div style={{fontWeight:600}}>{f.profiles?.name||f.following_id} <span style={{color:"rgba(255,255,255,0.25)",fontSize:11}}>· view profile →</span></div>
                  <div style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>@{f.following_id} · {f.profiles?.goal} · {pts} pts this week</div>
                </div>
                <button onClick={()=>unfollow(f.following_id)} disabled={actionLoading[f.following_id]} style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",color:"#f87171",borderRadius:7,padding:"4px 10px",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  {actionLoading[f.following_id]?"...":"Unfollow"}
                </button>
              </Card>
            );
          })}
        </div>
      </>}
    </div>
  );
}

// PROFILE TAB
function ProfileTab({currentUser,user,curBMI,bmiI,streak,myPts,myRank,onUpdated}){
  const[editing,setEditing]=useState(false);
  const[visible,setVisible]=useState(user.profile_visible||{weight:true,bmi:true,streak:true,measurements:false});
  const[bio,setBio]=useState(user.bio||"");
  const[isPublic,setIsPublic]=useState(user.is_public!==false);
  const[saving,setSaving]=useState(false);
  const[weights,setWeights]=useState([]);
  const[meas,setMeas]=useState([]);

  useEffect(()=>{
    async function load(){const[wts,ms]=await Promise.all([dbGetAllWeights(currentUser.id),dbGetAllMeasurements(currentUser.id)]);setWeights(wts.slice(-14));setMeas(ms.slice(0,5));}
    load();
  },[currentUser.id]);

  async function save(){setSaving(true);await dbUpdateProfile(currentUser.id,{bio,is_public:isPublic,profile_visible:visible});onUpdated();setEditing(false);setSaving(false);}
  const toggleVisible=k=>setVisible(p=>({...p,[k]:!p[k]}));

  const wtVals=weights.map(w=>w.weight);
  const wMin=wtVals.length?Math.min(...wtVals)-1:50,wMax=wtVals.length?Math.max(...wtVals)+1:100;
  const cW=400,cH=90;

  return(
    <div style={{animation:"fadeUp 0.3s ease"}}>
      <Card style={{marginBottom:12,background:"rgba(251,191,36,0.04)",border:"1px solid rgba(251,191,36,0.15)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div>
            <div style={{fontFamily:"'Playfair Display',serif",color:"#fff",fontSize:22,fontWeight:700}}>{user.name}</div>
            <div style={{color:"rgba(255,255,255,0.4)",fontSize:13}}>@{currentUser.id}</div>
            {user.communities?.name&&<div style={{marginTop:4}}><Tag color="#a78bfa">{user.communities.name}</Tag></div>}
          </div>
          <div style={{fontSize:40}}>👤</div>
        </div>
        {user.bio&&<p style={{color:"rgba(255,255,255,0.55)",fontSize:13,lineHeight:1.6,marginBottom:12}}>{user.bio}</p>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
          {[["🎯",user.goal,"Goal"],["🏆",`#${myRank}`,"Rank"],["⚡",`${myPts} pts`,"This Week"]].map(([icon,val,label])=>(
            <div key={label} style={{textAlign:"center",background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"8px"}}><div style={{fontSize:16}}>{icon}</div><div style={{color:"#fbbf24",fontWeight:700,fontSize:14}}>{val}</div><div style={{color:"rgba(255,255,255,0.35)",fontSize:10}}>{label}</div></div>
          ))}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {visible.weight&&<Tag color="#60a5fa">⚖️ {user.weight}kg</Tag>}
          {visible.bmi&&<Tag color={bmiI.c}>📊 {curBMI} {bmiI.label}</Tag>}
          {visible.streak&&<Tag color="#f97316">🔥 {streak}d streak</Tag>}
          {visible.measurements&&meas[0]&&<Tag color="#34d399">📏 {meas[0].waist}" waist</Tag>}
        </div>
      </Card>
      <Card style={{marginBottom:12}}>
        <p style={STITLE}>My Stats</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}>
          {[["🎯 Goal",user.goal],["⚖️ Weight",user.weight+"kg"],["📏 Height",fmtHeight(user)],["🎂 Age",user.age+"y"],["📊 BMI",curBMI+" ("+bmiI.label+")"],["🏃 Activity",ACTIVITY_LEVELS.find(a=>+a.value===+user.activity)?.label?.split("(")[0].trim()||user.activity]].map(([l,v])=>(
            <div key={l} style={{background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"9px 11px"}}><div style={{color:"rgba(255,255,255,0.35)",fontSize:10}}>{l}</div><div style={{color:"#fff",fontWeight:600,fontSize:13,marginTop:2}}>{v}</div></div>
          ))}
        </div>
      </Card>
      {weights.length>1&&<Card style={{marginBottom:12}}>
        <p style={STITLE}>⚖️ Weight Trend</p>
        <svg width="100%" viewBox={`0 0 ${cW} ${cH+24}`} style={{display:"block"}}>
          {weights.map((w,i)=>{
            const x=(i/(weights.length-1))*cW,y=cH-((w.weight-wMin)/(wMax-wMin||1))*cH;
            return<g key={w.date}>
              {i>0&&(()=>{const px=((i-1)/(weights.length-1))*cW,py=cH-((weights[i-1].weight-wMin)/(wMax-wMin||1))*cH;return<line x1={px} y1={py} x2={x} y2={y} stroke="rgba(251,191,36,0.45)" strokeWidth={1.5}/>;})()}
              <circle cx={x} cy={y} r={3.5} fill="#fbbf24"/>
              <text x={x} y={y-7} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="8">{w.weight}kg</text>
              {(i===0||i===weights.length-1)&&<text x={x} y={cH+18} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="8">{w.date.slice(5)}</text>}
            </g>;
          })}
        </svg>
      </Card>}
      {meas.length>0&&<Card style={{marginBottom:12}}>
        <p style={STITLE}>📏 Measurement History (inches)</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:"6px 14px",fontSize:12}}>
          {["Week","Waist","Chest","Hips"].map(h=><span key={h} style={{color:"rgba(255,255,255,0.3)",fontWeight:600}}>{h}</span>)}
          {meas.map(m=>[
            <span key={m.week_start+"d"} style={{color:"rgba(255,255,255,0.45)"}}>{m.week_start}</span>,
            <span key={m.week_start+"w"} style={{color:"#fbbf24",fontWeight:600}}>{m.waist}"</span>,
            <span key={m.week_start+"c"} style={{color:"#60a5fa",fontWeight:600}}>{m.chest}"</span>,
            <span key={m.week_start+"h"} style={{color:"#34d399",fontWeight:600}}>{m.hips}"</span>,
          ])}
        </div>
      </Card>}
      <Card>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:editing?12:0}}>
          <p style={STITLE}>⚙️ Profile Settings</p>
          <Btn variant={editing?"ghost":"outline"} onClick={()=>setEditing(p=>!p)} style={{fontSize:12,padding:"5px 12px"}}>{editing?"Cancel":"Edit"}</Btn>
        </div>
        {editing&&<>
          <div style={{marginBottom:12}}><label style={LBL}>Bio</label><textarea value={bio} onChange={e=>setBio(e.target.value)} placeholder="Tell others about your fitness journey..." style={{...TS,minHeight:60}}/></div>
          <div style={{marginBottom:14}}><label style={LBL}>Public Profile</label><div style={{display:"flex",alignItems:"center",gap:10}}><input type="checkbox" checked={isPublic} onChange={e=>setIsPublic(e.target.checked)} style={{accentColor:"#fbbf24",width:16,height:16}}/><span style={{color:"rgba(255,255,255,0.6)",fontSize:13}}>Allow others to find and follow me</span></div></div>
          <div style={{marginBottom:14}}>
            <label style={LBL}>Show on Profile</label>
            <div style={{display:"grid",gap:8}}>
              {[["weight","⚖️ Current Weight"],["bmi","📊 BMI"],["streak","🔥 Streak"],["measurements","📏 Measurements"]].map(([k,label])=>(
                <div key={k} style={{display:"flex",alignItems:"center",gap:10}}><input type="checkbox" checked={!!visible[k]} onChange={()=>toggleVisible(k)} style={{accentColor:"#fbbf24",width:16,height:16}}/><span style={{color:"rgba(255,255,255,0.6)",fontSize:13}}>{label}</span></div>
              ))}
            </div>
          </div>
          <Btn onClick={save} disabled={saving} style={{width:"100%",padding:"11px"}}>{saving?"Saving...":"Save Changes"}</Btn>
        </>}
      </Card>
    </div>
  );
}

// ─── COMMUNITY LEADERBOARD (shown when user taps their gym/society) ───
function CommunityLeaderboard({currentUser,user,onBack}){
  const METRICS=[
    {id:"points",label:"⚡ Points",sub:"Weekly fitness points"},
    {id:"streak",label:"🔥 Streak",sub:"Consecutive days logged"},
    {id:"workouts",label:"🏋️ Workouts",sub:"Total workouts this month"},
    {id:"weight_loss",label:"⚖️ Weight Lost",sub:"kg lost since joining"},
  ];
  const[metric,setMetric]=useState("points");
  const[lb,setLb]=useState([]);
  const[loading,setLoading]=useState(true);
  const wk=weekStart();
  const monthStart=new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().split("T")[0];

  useEffect(()=>{
    async function load(){
      setLoading(true);
      const users=await dbGetAllUsers(user.community_id);
      const allUsers=[...users,{...user,id:currentUser.id}].filter((u,i,a)=>a.findIndex(x=>x.id===u.id)===i);

      let ranked=[];

      if(metric==="points"){
        const pts=await dbGetWeeklyPoints(allUsers,wk);
        ranked=allUsers.map(u=>({...u,score:pts[u.id]||0,scoreLabel:(pts[u.id]||0)+" pts"})).sort((a,b)=>b.score-a.score);

      } else if(metric==="streak"){
        const streaks=await Promise.all(allUsers.map(async u=>{
          const{data}=await supabase.from("daily_logs").select("date").eq("user_id",u.id).order("date",{ascending:false});
          let s=0;const dates=(data||[]).map(d=>d.date);const dateSet=new Set(dates);
          let chk=new Date();
          for(let i=0;i<365;i++){const k=chk.toISOString().split("T")[0];if(dateSet.has(k)){s++;chk.setDate(chk.getDate()-1);}else break;}
          return{id:u.id,streak:s};
        }));
        const sMap={};streaks.forEach(s=>sMap[s.id]=s.streak);
        ranked=allUsers.map(u=>({...u,score:sMap[u.id]||0,scoreLabel:(sMap[u.id]||0)+"d streak"})).sort((a,b)=>b.score-a.score);

      } else if(metric==="workouts"){
        const workouts=await Promise.all(allUsers.map(async u=>{
          const{data}=await supabase.from("daily_logs").select("exercise").eq("user_id",u.id).gte("date",monthStart);
          const count=(data||[]).filter(l=>l.exercise&&l.exercise.trim().length>3).length;
          return{id:u.id,count};
        }));
        const wMap={};workouts.forEach(w=>wMap[w.id]=w.count);
        ranked=allUsers.map(u=>({...u,score:wMap[u.id]||0,scoreLabel:(wMap[u.id]||0)+" workouts"})).sort((a,b)=>b.score-a.score);

      } else if(metric==="weight_loss"){
        const wloss=await Promise.all(allUsers.map(async u=>{
          const{data}=await supabase.from("weight_logs").select("weight,date").eq("user_id",u.id).order("date");
          if(!data||data.length<2)return{id:u.id,loss:0};
          const first=data[0].weight,last=data[data.length-1].weight;
          const loss=+(first-last).toFixed(1);
          return{id:u.id,loss:Math.max(0,loss)};
        }));
        const lMap={};wloss.forEach(w=>lMap[w.id]=w.loss);
        ranked=allUsers.map(u=>({...u,score:lMap[u.id]||0,scoreLabel:(lMap[u.id]||0)+"kg lost"})).sort((a,b)=>b.score-a.score);
      }

      setLb(ranked);setLoading(false);
    }
    load();
  },[metric,currentUser.id,user,wk,monthStart]);

  const myRank=lb.findIndex(e=>e.id===currentUser.id)+1;
  const myEntry=lb.find(e=>e.id===currentUser.id);
  const comm=user.communities;

  return(
    <div style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1.1rem"}}>
        <button onClick={onBack} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.45)",borderRadius:7,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>← Back</button>
        <div>
          <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:20}}>{comm?.logo_emoji} {comm?.name||"Community"}</h2>
          <p style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>{comm?.city} · {comm?.type}</p>
        </div>
      </div>
      {/* My standing card */}
      {myEntry&&<Card style={{marginBottom:14,border:"1px solid rgba(251,191,36,0.2)",background:"rgba(251,191,36,0.04)"}}>
        <p style={{...STITLE,marginBottom:8}}>Your Standing</p>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:32}}>{myRank===1?"🥇":myRank===2?"🥈":myRank===3?"🥉":`#${myRank}`}</span>
          <div style={{flex:1}}>
            <div style={{color:"#fbbf24",fontWeight:700,fontSize:18}}>{myEntry.scoreLabel}</div>
            <div style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>out of {lb.length} members</div>
          </div>
        </div>
      </Card>}
      {/* Metric selector */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        {METRICS.map(m=>(
          <button key={m.id} onClick={()=>setMetric(m.id)} style={{padding:"10px 12px",borderRadius:10,border:metric===m.id?"1px solid rgba(251,191,36,0.4)":"1px solid rgba(255,255,255,0.08)",background:metric===m.id?"rgba(251,191,36,0.08)":"rgba(255,255,255,0.02)",cursor:"pointer",textAlign:"left",fontFamily:"'DM Sans',sans-serif"}}>
            <div style={{color:metric===m.id?"#fbbf24":"rgba(255,255,255,0.7)",fontWeight:600,fontSize:13}}>{m.label}</div>
            <div style={{color:"rgba(255,255,255,0.3)",fontSize:11,marginTop:2}}>{m.sub}</div>
          </button>
        ))}
      </div>
      {/* Leaderboard */}
      {loading?<div style={{display:"flex",justifyContent:"center",padding:"2rem"}}><Spin/></div>:(
        <div style={{display:"grid",gap:8}}>
          {lb.map((e,i)=>{
            const isMe=e.id===currentUser.id;
            const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":null;
            return(
              <Card key={e.id} style={{display:"flex",alignItems:"center",gap:12,border:isMe?"1px solid rgba(251,191,36,0.25)":"1px solid rgba(255,255,255,0.07)",background:isMe?"rgba(251,191,36,0.03)":"rgba(255,255,255,0.035)"}}>
                <div style={{fontSize:medal?22:14,minWidth:30,textAlign:"center",fontWeight:700,color:medal?"inherit":"rgba(255,255,255,0.35)"}}>
                  {medal||`#${i+1}`}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:14,display:"flex",alignItems:"center",gap:6}}>
                    {e.name}{isMe&&<Tag color="#fbbf24">You</Tag>}
                  </div>
                  <div style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>{e.goal}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{color:i===0?"#fbbf24":i===1?"#94a3b8":i===2?"#d97706":"rgba(255,255,255,0.6)",fontWeight:700,fontSize:15}}>{e.scoreLabel}</div>
                </div>
              </Card>
            );
          })}
          {lb.length===0&&<p style={{color:"rgba(255,255,255,0.3)",textAlign:"center",padding:"1rem"}}>No data yet.</p>}
        </div>
      )}
    </div>
  );
}

// ─── CHALLENGE LEADERBOARD (shown when user taps a challenge) ───
function ChallengeLeaderboardView({currentUser,challenge,onBack}){
  const[lb,setLb]=useState([]);
  const[loading,setLoading]=useState(true);

  useEffect(()=>{
    async function load(){
      setLoading(true);
      const members=await dbGetChallengeMembers(challenge.id);
      const userProfiles=members.map(m=>m.profiles).filter(Boolean);
      if(!userProfiles.length){setLb([]);setLoading(false);return;}

      const logPromises=userProfiles.map(async u=>{
        const{data}=await supabase.from("daily_logs").select("meals,exercise,water,sleep,date").eq("user_id",u.id).gte("date",challenge.start_date).lte("date",challenge.end_date);
        return{userId:u.id,logs:data||[]};
      });
      const allLogs=await Promise.all(logPromises);

      const scored=members.map(m=>{
        const profile=m.profiles;
        if(!profile)return{...m,score:0,scoreLabel:"0",daysLogged:0};
        const userLogs=allLogs.find(l=>l.userId===profile.id)?.logs||[];
        let score=0,label="0";
        const daysLogged=userLogs.length;
        if(challenge.goal_type==="most_points"){
          score=userLogs.reduce((s,l)=>s+calcPts(l,profile),0);
          label=score+" pts";
        } else if(challenge.goal_type==="most_workouts"){
          score=userLogs.filter(l=>l.exercise&&l.exercise.trim().length>3).length;
          label=score+" workouts";
        } else if(challenge.goal_type==="longest_streak"){
          // consecutive days from start
          let streak=0,chk=new Date(challenge.start_date);
          const dateSet=new Set(userLogs.map(l=>l.date));
          while(chk<=new Date(Math.min(new Date(),new Date(challenge.end_date)))){
            const k=chk.toISOString().split("T")[0];
            if(dateSet.has(k)){streak++;chk.setDate(chk.getDate()+1);}else break;
          }
          score=streak;label=streak+"d streak";
        } else if(challenge.goal_type==="weight_loss"){
          score=userLogs.reduce((s,l)=>s+calcPts(l,profile),0);
          label=score+" pts";
        }
        return{...m,score,scoreLabel:label,daysLogged};
      }).sort((a,b)=>b.score-a.score);

      setLb(scored);setLoading(false);
    }
    load();
  },[challenge]);

  const myEntry=lb.find(e=>e.user_id===currentUser.id);
  const myRank=lb.findIndex(e=>e.user_id===currentUser.id)+1;
  const isActive=todayStr()>=challenge.start_date&&todayStr()<=challenge.end_date;
  const isEnded=todayStr()>challenge.end_date;

  return(
    <div style={{animation:"fadeUp 0.3s ease"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1.1rem"}}>
        <button onClick={onBack} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.45)",borderRadius:7,padding:"5px 12px",fontSize:12,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>← Back</button>
        <div>
          <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:20}}>{challenge.title}</h2>
          <div style={{display:"flex",gap:8,alignItems:"center",marginTop:2}}>
            <Tag color={isEnded?"#ef4444":isActive?"#22c55e":"#fbbf24"}>{isEnded?"Ended":isActive?"Active":"Upcoming"}</Tag>
            <span style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>{GOAL_TYPES.find(g=>g.value===challenge.goal_type)?.label}</span>
          </div>
        </div>
      </div>
      {/* My standing */}
      {myEntry&&<Card style={{marginBottom:14,border:"1px solid rgba(251,191,36,0.2)",background:"rgba(251,191,36,0.04)"}}>
        <p style={{...STITLE,marginBottom:8}}>Your Standing</p>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:32}}>{myRank===1?"🥇":myRank===2?"🥈":myRank===3?"🥉":`#${myRank}`}</span>
          <div style={{flex:1}}>
            <div style={{color:"#fbbf24",fontWeight:700,fontSize:18}}>{myEntry.scoreLabel}</div>
            <div style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>{myEntry.daysLogged} days logged · out of {lb.length} members</div>
          </div>
        </div>
      </Card>}
      {/* Challenge info */}
      <Card style={{marginBottom:14}}>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:12,color:"rgba(255,255,255,0.4)"}}>
          <span>📅 {challenge.start_date} → {challenge.end_date}</span>
          <span>👤 {challenge.profiles?.name||challenge.creator_id}</span>
          <span>👥 {lb.length} members</span>
        </div>
        <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
          <span style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>Join code:</span>
          <span style={{fontFamily:"monospace",color:"#fbbf24",fontSize:14,letterSpacing:3,fontWeight:700}}>{challenge.join_code}</span>
        </div>
      </Card>
      {/* Full leaderboard */}
      <h3 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:17,marginBottom:10}}>🏆 Leaderboard</h3>
      {loading?<div style={{display:"flex",justifyContent:"center",padding:"2rem"}}><Spin/></div>:(
        <div style={{display:"grid",gap:8}}>
          {lb.map((e,i)=>{
            const isMe=e.user_id===currentUser.id;
            const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":null;
            return(
              <Card key={e.id||i} style={{display:"flex",alignItems:"center",gap:12,border:isMe?"1px solid rgba(251,191,36,0.25)":"1px solid rgba(255,255,255,0.07)",background:isMe?"rgba(251,191,36,0.03)":"rgba(255,255,255,0.035)"}}>
                <div style={{fontSize:medal?22:14,minWidth:30,textAlign:"center",fontWeight:700,color:medal?"inherit":"rgba(255,255,255,0.35)"}}>
                  {medal||`#${i+1}`}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:14,display:"flex",alignItems:"center",gap:6}}>
                    {e.profiles?.name||e.user_id}{isMe&&<Tag color="#fbbf24">You</Tag>}
                  </div>
                  <div style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>{e.daysLogged} days logged</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{color:i===0?"#fbbf24":i===1?"#94a3b8":i===2?"#d97706":"rgba(255,255,255,0.6)",fontWeight:700,fontSize:16}}>{e.scoreLabel}</div>
                </div>
              </Card>
            );
          })}
          {lb.length===0&&<p style={{color:"rgba(255,255,255,0.3)",textAlign:"center",padding:"1rem"}}>No members yet.</p>}
        </div>
      )}
    </div>
  );
}

// RANKINGS TAB — hub showing community + challenges
function RankingsTab({currentUser,user}){
  const[view,setView]=useState("hub"); // hub | community | challenge
  const[challenges,setChallenges]=useState([]);
  const[selectedChallenge,setSelectedChallenge]=useState(null);
  const[loading,setLoading]=useState(true);
  const comm=user.communities;

  useEffect(()=>{
    async function load(){
      const c=await dbGetMyChallenges(currentUser.id);
      setChallenges(c);setLoading(false);
    }
    load();
  },[currentUser.id]);

  function goChallenge(c){setSelectedChallenge(c);setView("challenge");}
  function goBack(){setSelectedChallenge(null);setView("hub");}

  return(
    <div style={{animation:"fadeUp 0.3s ease"}}>
      {view==="community"&&<CommunityLeaderboard currentUser={currentUser} user={user} onBack={goBack}/>}
      {view==="challenge"&&selectedChallenge&&<ChallengeLeaderboardView currentUser={currentUser} challenge={selectedChallenge} onBack={goBack}/>}
      <div style={{display:view==="hub"?"block":"none"}}>
      <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",marginBottom:"1.1rem",fontSize:21}}>🏆 Rankings</h2>

      {/* Community card */}
      {comm&&(
        <>
          <p style={{...STITLE,marginBottom:8}}>Your Community</p>
          <div style={{marginBottom:18,cursor:"pointer",background:"rgba(251,191,36,0.03)",border:"1px solid rgba(251,191,36,0.15)",borderRadius:14,padding:"1.1rem 1.3rem"}} onClick={()=>setView("community")}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:32}}>{comm.logo_emoji}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:16,color:"#fff"}}>{comm.name}</div>
                <div style={{color:"rgba(255,255,255,0.4)",fontSize:12,marginTop:2}}>{comm.city} · {comm.type}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{color:"#fbbf24",fontSize:12,fontWeight:600}}>View standings →</div>
                <div style={{color:"rgba(255,255,255,0.3)",fontSize:11,marginTop:2}}>Points · Streak · Workouts</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Challenges */}
      <p style={{...STITLE,marginBottom:8}}>Your Challenges</p>
      {loading?<div style={{display:"flex",justifyContent:"center",padding:"2rem"}}><Spin/></div>:(
        challenges.length===0?(
          <Card style={{padding:"1.5rem",textAlign:"center"}}>
            <div style={{fontSize:32,marginBottom:8}}>⚔️</div>
            <p style={{color:"rgba(255,255,255,0.4)",fontSize:13,marginBottom:4}}>No challenges joined yet.</p>
            <p style={{color:"rgba(255,255,255,0.25)",fontSize:12}}>Go to the Challenges tab to create or join one.</p>
          </Card>
        ):(
          <div style={{display:"grid",gap:9}}>
            {challenges.map(c=>{
              const isActive=todayStr()>=c.start_date&&todayStr()<=c.end_date;
              const isEnded=todayStr()>c.end_date;
              const goalLabel=GOAL_TYPES.find(g=>g.value===c.goal_type)?.label||c.goal_type;
              return(
                <div key={c.id} style={{cursor:"pointer",background:"rgba(255,255,255,0.035)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:14,padding:"1.1rem 1.3rem"}} onClick={()=>goChallenge(c)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{flex:1,paddingRight:10}}>
                      <div style={{fontWeight:700,fontSize:15,marginBottom:3}}>{c.title}</div>
                      <div style={{color:"rgba(255,255,255,0.4)",fontSize:12}}>🎯 {goalLabel} · 📅 {c.start_date} → {c.end_date}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                      <Tag color={isEnded?"#ef4444":isActive?"#22c55e":"#fbbf24"}>{isEnded?"Ended":isActive?"Active":"Upcoming"}</Tag>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{fontFamily:"monospace",color:"rgba(251,191,36,0.6)",fontSize:12,letterSpacing:2}}>{c.join_code}</div>
                    <span style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>View leaderboard →</span>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
      <div style={{marginTop:16}}>
        <Card>
          <p style={STITLE}>How Points Work</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,color:"rgba(255,255,255,0.38)",fontSize:12}}>
            <span>💧 8+ glasses water: +20</span><span>😴 7+ hrs sleep: +20</span>
            <span>🏋️ Exercise logged: +30</span><span>🍽️ Meals logged: +5</span>
            <span>🎯 Hit calorie target: +15</span><span>💪 Hit protein target: +15</span>
          </div>
        </Card>
      </div>
      </div>
    </div>
  );
}

// ADMIN PANEL
function AdminPanel({currentUser,onLogout}){
  const[tab,setTab]=useState("members");
  const[users,setUsers]=useState([]);
  const[communities,setCommunities]=useState([]);
  const[loading,setLoading]=useState(true);
  const[form,setForm]=useState({id:"",name:"",password:"",age:"",weight:"",height:"",gender:"male",goal:"Lose Weight",activity:1.55,community_id:""});
  const[commForm,setCommForm]=useState({name:"",type:"gym",city:"",join_code:"",admin_password:"",logo_emoji:"🏋️"});
  const[msg,setMsg]=useState("");
  const[viewUser,setViewUser]=useState(null);
  const[userLogs,setUserLogs]=useState([]);
  const[weekPts,setWeekPts]=useState({});
  const[selectedComm,setSelectedComm]=useState(currentUser.is_super_admin?"all":(currentUser.community_id||"all"));
  const wk=weekStart();
  const F=(k,v)=>setForm(p=>({...p,[k]:v}));
  const CF=(k,v)=>setCommForm(p=>({...p,[k]:v}));

  const load=useCallback(async()=>{
    setLoading(true);
    const commFilter=currentUser.is_super_admin?(selectedComm==="all"?null:selectedComm):currentUser.community_id;
    const[u,c]=await Promise.all([dbGetAllUsers(commFilter),dbGetAllCommunities()]);
    setUsers(u);setCommunities(c);
    if(u.length>0){const pts=await dbGetWeeklyPoints(u,wk);setWeekPts(pts);}
    setLoading(false);
  },[selectedComm,wk,currentUser.is_super_admin,currentUser.community_id]);

  useEffect(()=>{load();},[load]);

  async function createUser(){
    if(!form.id||!form.name||!form.password||!form.age||!form.weight||!form.height){setMsg("Fill all fields.");return;}
    try{await dbSignUp({id:form.id.trim(),name:form.name,password:form.password,age:+form.age,weight:+form.weight,height_cm:+form.height,gender:form.gender,goal:form.goal,activity:+form.activity,community_id:form.community_id||null,is_admin:false,is_super_admin:false});setMsg("✅ Account created for "+form.name+"!");setForm({id:"",name:"",password:"",age:"",weight:"",height:"",gender:"male",goal:"Lose Weight",activity:1.55,community_id:""});load();}
    catch(e){setMsg("Error: "+e.message);}
  }
  async function createCommunity(){
    if(!commForm.name||!commForm.join_code||!commForm.admin_password){setMsg("Fill name, join code, and admin password.");return;}
    try{const{error}=await supabase.from("communities").insert({...commForm,join_code:commForm.join_code.toUpperCase()});if(error)throw new Error(error.message);setMsg("✅ Community '"+commForm.name+"' created! Join code: "+commForm.join_code.toUpperCase());setCommForm({name:"",type:"gym",city:"",join_code:"",admin_password:"",logo_emoji:"🏋️"});load();}
    catch(e){setMsg("Error: "+e.message);}
  }
  async function viewLogs(u){setViewUser(u);setTab("logs");const logs=await dbGetAllLogs(u.id);setUserLogs(logs);}
  async function del(id){if(!window.confirm("Delete user @"+id+"? This permanently deletes all their data."))return;await supabase.from("profiles").delete().eq("id",id);load();}
  async function deleteCommunity(commId,name){if(!window.confirm("Delete community "+name+"? This deletes ALL members and their data permanently."))return;await supabase.from("communities").delete().eq("id",commId);setMsg("Community deleted.");load();}

  const isSuperAdmin=currentUser.is_super_admin;
  const lb=[...users].map(u=>({...u,pts:weekPts[u.id]||0})).sort((a,b)=>b.pts-a.pts);
  const NAV=[{id:"members",l:"👥 Members"},{id:"create",l:"➕ Add Member"},...(isSuperAdmin?[{id:"communities",l:"🏢 Communities"},{id:"leaderboard",l:"🏆 Leaderboard"}]:[]),{id:"logs",l:"📋 Logs"}];

  return(
    <div style={{minHeight:"100vh",background:BG,color:"#fff",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{CSS}</style>
      <div style={{background:"rgba(0,0,0,0.45)",borderBottom:"1px solid rgba(251,191,36,0.1)",padding:"0 1.5rem",display:"flex",alignItems:"center",justifyContent:"space-between",height:55}}>
        <div style={{display:"flex",alignItems:"center",gap:9}}><span style={{fontSize:20}}>🏆</span><span style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontWeight:700,fontSize:17}}>FitFamily</span>{isSuperAdmin?<Tag color="#fbbf24">Super Admin</Tag>:<Tag color="#60a5fa">Community Admin</Tag>}</div>
        <button onClick={onLogout} style={{padding:"5px 13px",borderRadius:9,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.22)",color:"#f87171",cursor:"pointer",fontSize:12,fontFamily:"'DM Sans',sans-serif"}}>Sign Out</button>
      </div>
      <div style={{display:"flex",gap:2,padding:"0.8rem 1.5rem 0",borderBottom:"1px solid rgba(255,255,255,0.05)",overflowX:"auto"}}>
        {NAV.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{background:tab===t.id?"rgba(251,191,36,0.1)":"transparent",border:tab===t.id?"1px solid rgba(251,191,36,0.22)":"1px solid transparent",color:tab===t.id?"#fbbf24":"rgba(255,255,255,0.38)",borderRadius:"7px 7px 0 0",padding:"7px 14px",cursor:"pointer",fontSize:13,fontFamily:"'DM Sans',sans-serif",fontWeight:tab===t.id?600:400,whiteSpace:"nowrap"}}>{t.l}</button>)}
      </div>
      <div style={{padding:"1.5rem",maxWidth:900,margin:"0 auto"}}>
        {tab==="members"&&<div style={{animation:"fadeUp 0.3s ease"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.2rem"}}>
            <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontSize:21}}>Members ({users.length})</h2>
            {isSuperAdmin&&<select value={selectedComm} onChange={e=>setSelectedComm(e.target.value)} style={{...SS,width:"auto",padding:"6px 12px",fontSize:12}}>
              <option value="all">All Communities</option>
              {communities.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>}
          </div>
          {loading?<div style={{display:"flex",justifyContent:"center",padding:"2rem"}}><Spin/></div>:(
            <div style={{display:"grid",gap:10}}>
              {users.map(u=>{
                const bmi=calcBMI(u.weight,u.height_cm),cat=bmiCat(bmi),comm=communities.find(c=>c.id===u.community_id);
                return<Card key={u.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:4}}>
                      <span style={{fontWeight:600,fontSize:15}}>{u.name}</span><Tag color="#60a5fa">@{u.id}</Tag><Tag color={cat.c}>{cat.label}</Tag>
                      {comm&&<Tag color="#a78bfa">{comm.logo_emoji} {comm.name}</Tag>}
                    </div>
                    <div style={{color:"rgba(255,255,255,0.38)",fontSize:12,display:"flex",gap:12,flexWrap:"wrap"}}>
                      <span>{u.age}y · {u.gender} · {u.weight}kg · {fmtHeight(u)}</span><span>BMI {bmi} · {u.goal}</span><span>This week: {weekPts[u.id]||0} pts</span>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:7}}>
                    <Btn onClick={()=>viewLogs(u)} variant="ghost" style={{fontSize:12,padding:"5px 11px"}}>Logs</Btn>
                    <Btn onClick={()=>del(u.id)} variant="danger" style={{fontSize:12,padding:"5px 11px"}}>Delete</Btn>
                  </div>
                </Card>;
              })}
              {users.length===0&&<p style={{color:"rgba(255,255,255,0.3)"}}>No members yet.</p>}
            </div>
          )}
        </div>}
        {tab==="create"&&<div style={{animation:"fadeUp 0.3s ease",maxWidth:480}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",marginBottom:"1.2rem",fontSize:21}}>Add Member</h2>
          {msg&&<div style={{background:msg.startsWith("✅")?"rgba(34,197,94,0.09)":"rgba(239,68,68,0.09)",border:`1px solid ${msg.startsWith("✅")?"rgba(34,197,94,0.25)":"rgba(239,68,68,0.25)"}`,borderRadius:9,padding:"9px 13px",marginBottom:14,color:msg.startsWith("✅")?"#22c55e":"#f87171",fontSize:13}}>{msg}</div>}
          <Card>
            {[["Username","id","text","e.g. priya123"],["Full Name","name","text","Priya Sharma"],["Password","password","password","Create password"],["Age","age","number","28"],["Weight (kg)","weight","number","65"],["Height (cm)","height","number","175"]].map(([l,k,t,ph])=><FInput key={k} label={l} type={t} placeholder={ph} value={form[k]} onChange={e=>F(k,e.target.value)}/>)}
            <FSelect label="Community" value={form.community_id} onChange={e=>F("community_id",e.target.value)}><option value="">No Community</option>{communities.map(c=><option key={c.id} value={c.id}>{c.logo_emoji} {c.name}</option>)}</FSelect>
            <FSelect label="Gender" value={form.gender} onChange={e=>F("gender",e.target.value)}><option value="male">Male</option><option value="female">Female</option></FSelect>
            <FSelect label="Goal" value={form.goal} onChange={e=>F("goal",e.target.value)}>{GOALS.map(g=><option key={g} value={g}>{g}</option>)}</FSelect>
            <FSelect label="Activity" value={form.activity} onChange={e=>F("activity",e.target.value)}>{ACTIVITY_LEVELS.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}</FSelect>
            <Btn onClick={createUser} style={{width:"100%",padding:"12px"}}>Create Account →</Btn>
          </Card>
        </div>}
        {tab==="communities"&&<div style={{animation:"fadeUp 0.3s ease"}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",marginBottom:"1.2rem",fontSize:21}}>Communities</h2>
          {msg&&<div style={{background:msg.startsWith("✅")?"rgba(34,197,94,0.09)":"rgba(239,68,68,0.09)",border:`1px solid ${msg.startsWith("✅")?"rgba(34,197,94,0.25)":"rgba(239,68,68,0.25)"}`,borderRadius:9,padding:"9px 13px",marginBottom:14,color:msg.startsWith("✅")?"#22c55e":"#f87171",fontSize:13}}>{msg}</div>}
          <div style={{display:"grid",gap:10,marginBottom:20}}>
            {communities.map(c=><Card key={c.id} style={{display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:28}}>{c.logo_emoji}</span>
              <div style={{flex:1}}><div style={{fontWeight:600,fontSize:15}}>{c.name}</div><div style={{color:"rgba(255,255,255,0.38)",fontSize:12}}>{c.type} · {c.city}</div></div>
              <div style={{textAlign:"right",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                <div style={{background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:6,padding:"3px 12px",fontSize:14,fontFamily:"monospace",color:"#fbbf24",letterSpacing:2}}>{c.join_code}</div>
                <div style={{color:"rgba(255,255,255,0.3)",fontSize:10}}>join code</div>
                <Btn onClick={()=>deleteCommunity(c.id,c.name)} variant="danger" style={{fontSize:11,padding:"3px 10px"}}>Delete</Btn>
              </div>
            </Card>)}
          </div>
          <h3 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",marginBottom:12,fontSize:17}}>Add New Community</h3>
          <Card>
            <FInput label="Gym / Society Name" value={commForm.name} onChange={e=>CF("name",e.target.value)} placeholder="e.g. Black Vigour Gym"/>
            <FSelect label="Type" value={commForm.type} onChange={e=>CF("type",e.target.value)}><option value="gym">Gym</option><option value="society">Society / RWA</option><option value="corporate">Corporate</option></FSelect>
            <FInput label="City" value={commForm.city} onChange={e=>CF("city",e.target.value)} placeholder="e.g. Delhi"/>
            <FInput label="Join Code" value={commForm.join_code} onChange={e=>CF("join_code",e.target.value.toUpperCase())} placeholder="e.g. BLKVGR" style={{textTransform:"uppercase",letterSpacing:3}}/>
            <FInput label="Admin Password" type="password" value={commForm.admin_password} onChange={e=>CF("admin_password",e.target.value)} placeholder="Password for community admin"/>
            <div style={{marginBottom:12}}>
              <label style={LBL}>Logo Emoji</label>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {["🏋️","💪","🧘","🏃","⚽","🏊","🚴","🥊","🏠","🌿"].map(e=><button key={e} onClick={()=>CF("logo_emoji",e)} style={{fontSize:24,padding:"6px",borderRadius:8,border:`2px solid ${commForm.logo_emoji===e?"#fbbf24":"rgba(255,255,255,0.1)"}`,background:commForm.logo_emoji===e?"rgba(251,191,36,0.1)":"transparent",cursor:"pointer"}}>{e}</button>)}
              </div>
            </div>
            <Btn onClick={createCommunity} style={{width:"100%",padding:"12px"}}>Create Community →</Btn>
          </Card>
        </div>}
        {tab==="leaderboard"&&<div style={{animation:"fadeUp 0.3s ease"}}>
          <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",marginBottom:5,fontSize:21}}>🏆 Leaderboard</h2>
          <p style={{color:"rgba(255,255,255,0.3)",fontSize:12,marginBottom:"1.2rem"}}>Week of {wk} — All Communities</p>
          <div style={{display:"grid",gap:9}}>
            {lb.map((u,i)=>{const comm=communities.find(c=>c.id===u.community_id);return<Card key={u.id} style={{display:"flex",alignItems:"center",gap:13}}>
              <span style={{fontSize:24,minWidth:32}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</span>
              <div style={{flex:1}}><div style={{fontWeight:600}}>{u.name} <span style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>@{u.id}</span></div><div style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>{u.goal}{comm?` · ${comm.logo_emoji} ${comm.name}`:""}</div></div>
              <div style={{textAlign:"right"}}><div style={{color:"#fbbf24",fontWeight:700,fontSize:18}}>{u.pts}</div><div style={{color:"rgba(255,255,255,0.28)",fontSize:10}}>pts</div></div>
            </Card>;})}
            {lb.length===0&&<p style={{color:"rgba(255,255,255,0.3)"}}>No members yet.</p>}
          </div>
        </div>}
        {tab==="logs"&&<div style={{animation:"fadeUp 0.3s ease"}}>
          {!viewUser?<div>
            <h2 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",marginBottom:"1.2rem",fontSize:21}}>All Logs</h2>
            <div style={{display:"grid",gap:9}}>{users.map(u=><Card key={u.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>viewLogs(u)}><span style={{fontWeight:600}}>{u.name} <span style={{color:"rgba(255,255,255,0.35)",fontSize:12}}>@{u.id}</span></span><span style={{color:"rgba(255,255,255,0.3)",fontSize:12}}>View logs →</span></Card>)}</div>
          </div>:<div>
            <button onClick={()=>setViewUser(null)} style={{background:"transparent",border:"1px solid rgba(255,255,255,0.12)",color:"rgba(255,255,255,0.45)",borderRadius:7,padding:"5px 12px",fontSize:12,marginBottom:14,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>← Back</button>
            <h3 style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",marginBottom:12,fontSize:17}}>Logs — {viewUser.name}</h3>
            <div style={{display:"grid",gap:8}}>
              {userLogs.map(log=>{const col=dayColor(log,viewUser),pts=calcPts(log,viewUser);return<Card key={log.date} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:9}}><div style={{width:9,height:9,borderRadius:"50%",background:col||"rgba(255,255,255,0.15)"}}/><span>{log.date}</span>{log.exercise&&<Tag color="#34d399">Exercised</Tag>}{Array.isArray(log.meals)&&log.meals.length>0&&<Tag color="#fbbf24">{log.meals.length} meals</Tag>}</div>
                <Tag color="#fbbf24">{pts} pts</Tag>
              </Card>;})}
              {userLogs.length===0&&<p style={{color:"rgba(255,255,255,0.3)"}}>No logs yet.</p>}
            </div>
          </div>}
        </div>}
      </div>
    </div>
  );
}

// USER DASHBOARD
function UserDashboard({currentUser,onLogout}){
  const[tab,setTab]=useState("log");
  const[refreshKey,setRefreshKey]=useState(0);
  const onSaved=useCallback(()=>setRefreshKey(k=>k+1),[]);
  const today=todayStr();
  const user=currentUser;
  const tdee=calcTDEE(user.weight,user.height_cm,user.age,user.gender,user.activity);
  const tCal=calcTarget(tdee,user.goal);
  const tPro=pTarget(user.weight,user.goal);
  const tCar=cTarget(tdee,user.goal);
  const tFat=fTarget(tdee,user.goal);
  const[streak,setStreak]=useState(0);
  const[myPts,setMyPts]=useState(0);
  const[myRank,setMyRank]=useState(1);
  const[latestWt,setLatestWt]=useState(user.weight);
  const[pendingRequests,setPendingRequests]=useState(0);

  useEffect(()=>{
    async function loadStats(){
      const wk=weekStart();
      const[allLogs,allUsers,allWts,reqs]=await Promise.all([dbGetAllLogs(currentUser.id),dbGetAllUsers(user.community_id),dbGetAllWeights(currentUser.id),dbGetFollowRequests(currentUser.id)]);
      let s=0;const logDates=new Set(allLogs.map(l=>l.date));let chk=new Date();
      for(let i=0;i<365;i++){const k=chk.toISOString().split("T")[0];if(logDates.has(k)){s++;chk.setDate(chk.getDate()-1);}else break;}
      setStreak(s);
      if(allWts.length>0)setLatestWt(allWts[allWts.length-1].weight);
      const weekLogs=allLogs.filter(l=>l.date>=wk);
      const myP=weekLogs.reduce((sum,l)=>sum+calcPts(l,user),0);setMyPts(myP);
      const allUsersWithMe=[...allUsers,{...user,id:currentUser.id}];
      const pts=await dbGetWeeklyPoints(allUsersWithMe,wk);
      const ranked=Object.entries(pts).sort(([,a],[,b])=>b-a);
      setMyRank((ranked.findIndex(([id])=>id===currentUser.id)+1)||1);
      setPendingRequests(reqs.length);
    }
    loadStats();
  },[currentUser.id,refreshKey,user]);

  const curBMI=calcBMI(latestWt,user.height_cm);
  const bmiI=bmiCat(curBMI);
  const comm=user.communities;
  const NAV=[
    {id:"log",l:"📝 Log"},
    {id:"report",l:"📊 Reports"},
    {id:"rankings",l:"🏆 Rankings"},
    {id:"challenges",l:"⚔️ Challenges"},
    {id:"social",l:`👥 Social${pendingRequests>0?` (${pendingRequests})`:""}`},
    {id:"profile",l:"👤 Profile"},
  ];

  return(
    <div style={{minHeight:"100vh",background:BG,color:"#fff",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{CSS}</style>
      <div style={{background:"rgba(0,0,0,0.45)",borderBottom:"1px solid rgba(251,191,36,0.09)",padding:"0 1.5rem",display:"flex",alignItems:"center",justifyContent:"space-between",height:54}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:18}}>{comm?.logo_emoji||"🏆"}</span>
          <div><span style={{fontFamily:"'Playfair Display',serif",color:"#fbbf24",fontWeight:700,fontSize:16}}>FitFamily</span>{comm&&<span style={{color:"rgba(255,255,255,0.35)",fontSize:11,marginLeft:6}}>{comm.name}</span>}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <Tag color="#22c55e">#{myRank}</Tag><Tag color="#fbbf24">{myPts}pts</Tag><Tag color="#f97316">🔥{streak}d</Tag>
          <button onClick={onLogout} style={{padding:"4px 11px",borderRadius:8,background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.22)",color:"#f87171",cursor:"pointer",fontSize:11,marginLeft:4,fontFamily:"'DM Sans',sans-serif"}}>Out</button>
        </div>
      </div>
      <div style={{display:"flex",gap:2,padding:"0.7rem 1.5rem 0",borderBottom:"1px solid rgba(255,255,255,0.05)",overflowX:"auto"}}>
        {NAV.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{background:tab===t.id?"rgba(251,191,36,0.09)":"transparent",border:tab===t.id?"1px solid rgba(251,191,36,0.2)":"1px solid transparent",color:tab===t.id?"#fbbf24":"rgba(255,255,255,0.38)",borderRadius:"7px 7px 0 0",padding:"6px 14px",cursor:"pointer",fontSize:13,fontFamily:"'DM Sans',sans-serif",fontWeight:tab===t.id?600:400,whiteSpace:"nowrap"}}>{t.l}</button>)}
      </div>
      <div style={{background:"rgba(0,0,0,0.25)",borderBottom:"1px solid rgba(255,255,255,0.04)",padding:"0.5rem 1.5rem",display:"flex",gap:18,overflowX:"auto",fontSize:12,color:"rgba(255,255,255,0.38)"}}>
        <span>⚡ <strong style={{color:"#fbbf24"}}>{tCal}kcal</strong> target</span>
        <span>💪 <strong style={{color:"#60a5fa"}}>{tPro}g</strong> protein</span>
        <span>📊 BMI <strong style={{color:bmiI.c}}>{curBMI} {bmiI.label}</strong></span>
        <span>⚖️ <strong style={{color:"#34d399"}}>{latestWt}kg</strong></span>
        <span>🎯 <strong style={{color:"#a78bfa"}}>{user.goal}</strong></span>
      </div>
      <div style={{padding:"1.3rem 1.5rem",maxWidth:800,margin:"0 auto"}}>
        <div style={{display:tab==="log"?"block":"none"}}>
          <LogTab currentUser={currentUser} user={user} tCal={tCal} tPro={tPro} tCar={tCar} tFat={tFat} streak={streak} today={today} onSaved={onSaved}/>
        </div>
        {tab==="report"&&<ReportTab key={refreshKey} currentUser={currentUser} user={user} tCal={tCal} tPro={tPro} tCar={tCar} tFat={tFat}/>}
        <div style={{display:tab==="rankings"?"block":"none"}}><RankingsTab key="rankings" currentUser={currentUser} user={user}/></div>
        {tab==="challenges"&&<ChallengesTab currentUser={currentUser} user={user}/>}
        {tab==="social"&&<SocialTab currentUser={currentUser} user={user}/>}
        {tab==="profile"&&<ProfileTab currentUser={currentUser} user={user} curBMI={curBMI} bmiI={bmiI} streak={streak} myPts={myPts} myRank={myRank} onUpdated={onSaved}/>}
      </div>
    </div>
  );
}

// APP ROOT
export default function App(){
  const[session,setSession]=useState(null);
  const[checking,setChecking]=useState(true);

  useEffect(()=>{
    const saved=localStorage.getItem("fitfamily_session");
    if(saved){
      try{
        const parsed=JSON.parse(saved);
        dbLogin(parsed.id,parsed.password).then(user=>{setSession(user);}).catch(()=>{localStorage.removeItem("fitfamily_session");}).finally(()=>setChecking(false));
      }catch{localStorage.removeItem("fitfamily_session");setChecking(false);}
    }else{setChecking(false);}
  },[]);

  function handleLogin(user){localStorage.setItem("fitfamily_session",JSON.stringify({id:user.id,password:user.password}));setSession(user);}
  function handleLogout(){localStorage.removeItem("fitfamily_session");setSession(null);}

  if(checking)return(
    <div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif"}}>
      <style>{CSS}</style>
      <div style={{textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>🏆</div><Spin/></div>
    </div>
  );

  if(!session)return<AuthScreen onLogin={handleLogin}/>;
  if(session.is_super_admin||session.is_admin)return<AdminPanel currentUser={session} onLogout={handleLogout}/>;
  return<UserDashboard currentUser={session} onLogout={handleLogout}/>;
}
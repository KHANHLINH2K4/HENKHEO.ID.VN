import React, { useEffect, useRef, useState } from "react";
import {
  MessageCircle, X, Send, Loader2, Bot
} from "lucide-react";
import { apiGet, apiSend } from "../lib/api.js";
import { C, displayFont, bodyFont, gradPrimary, gradWarm } from "../lib/theme.js";

export function ChatWidget({ setView, setPreselectService, user }) {
  const [open,setOpen]=useState(false),[input,setInput]=useState(""),[loading,setLoading]=useState(false),[conversationId,setConversationId]=useState(null),[conversationToken,setConversationToken]=useState(null),[lastMeta,setLastMeta]=useState(null);
  const greeting={role:"assistant",text:"Xin chào 👋 Mình là trợ lý Hẹn Khéo. Bạn có thể hỏi về dịch vụ, giá, thời lượng, giờ làm việc hoặc yêu cầu đặt/hủy/đổi lịch."};
  const [messages,setMessages]=useState([greeting]);
  const scrollRef=useRef(null);
  const storageKey=`henkheo_chat_${user?.id||"guest"}`;

  useEffect(()=>{
    let active=true;
    const restore=async()=>{
      const saved=localStorage.getItem(storageKey);
      if(!saved||!user?.id)return;
      const id=Number(saved);
      if(!Number.isInteger(id)||id<=0)return;
      try{
        const rows=await apiGet(`/chat/history/${id}`);
        if(!active||!rows?.length)return;
        setConversationId(id);
        setMessages(rows.map(r=>({role:r.role,text:r.message})));
      }catch{}
    };
    restore();
    return()=>{active=false;};
  },[storageKey,user?.id]);

  useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:"smooth"});},[messages,loading,open]);

  const send=async()=>{
    const text=input.trim(); if(!text||loading)return;
    const next=[...messages,{role:"user",text}]; setMessages(next); setInput(""); setLoading(true);
    try{
      const data=await apiSend("/chat","POST",{messages:next.slice(-20),conversationId,conversationToken});
      setConversationId(data.conversationId);
      setConversationToken(data.conversationToken||null);
      localStorage.setItem(storageKey,String(data.conversationId));
      setLastMeta(data);
      setMessages(prev=>[...prev,{role:"assistant",text:data.reply}]);
    }catch(e){setMessages(prev=>[...prev,{role:"assistant",text:`Xin lỗi, chatbot gặp lỗi: ${e.message}`}]);}
    finally{setLoading(false);}
  };

  const openBooking=()=>{
    if(lastMeta?.action?.type==="OPEN_BOOKING") {
      if(lastMeta.action.serviceId)setPreselectService(lastMeta.action.serviceId);
      setOpen(false);
      setView("booking");
    }
  };
  const goToLogin=()=>{ setOpen(false); setView("login"); };
  const goToMyAppointments=()=>{ setOpen(false); setView("customer"); };
  const actionType=lastMeta?.action?.type;
  return <><button onClick={()=>setOpen(v=>!v)} style={{background:gradPrimary}} className="fixed bottom-5 right-5 sm:right-8 w-14 h-14 rounded-full flex items-center justify-center z-50 shadow-xl">{open?<X size={22} color="#fff"/>:<MessageCircle size={22} color="#fff"/>}</button>{open&&<div className="glass-strong fixed bottom-24 right-5 sm:right-8 w-[92vw] max-w-sm h-[70vh] max-h-[560px] rounded-[28px] flex flex-col z-50 overflow-hidden shadow-2xl"><div style={{background:gradPrimary}} className="px-5 py-4 flex items-center justify-between"><div className="flex items-center gap-2.5"><Bot size={18} color="#fff"/><div><div style={{fontFamily:displayFont}} className="text-white font-bold text-sm">Trợ lý Hẹn Khéo</div><div style={{fontFamily:bodyFont}} className="text-white/70 text-[11px]">NLP: hiểu ý định &amp; đặt lịch ngay trong chat</div></div></div><button onClick={()=>setOpen(false)}><X size={18} color="#fff"/></button></div><div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">{messages.map((m,i)=><div key={i} className={`flex ${m.role==="user"?"justify-end":"justify-start"}`}><div style={{background:m.role==="user"?gradPrimary:"rgba(255,255,255,.9)",color:m.role==="user"?"#fff":C.ink,fontFamily:bodyFont}} className="max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap">{m.text}</div></div>)}{loading&&<div style={{fontFamily:bodyFont,color:C.inkSoft}} className="text-xs flex items-center gap-2"><Loader2 size={13} className="animate-spin"/>Đang phân tích...</div>}</div><div className="p-3" style={{borderTop:`1px solid ${C.line}`}}>{actionType==="OPEN_BOOKING"&&<button onClick={openBooking} style={{fontFamily:bodyFont,color:C.primary,background:"rgba(108,76,240,.06)"}} className="w-full py-2.5 rounded-xl text-xs font-bold mb-2">Mở đặt lịch{lastMeta.entities?.service?.service_name?` – ${lastMeta.entities.service.service_name}`:""}</button>}{actionType==="LOGIN_REQUIRED"&&<button onClick={goToLogin} style={{fontFamily:bodyFont,color:"#fff",background:gradPrimary}} className="w-full py-2.5 rounded-xl text-xs font-bold mb-2">Đăng nhập để đặt lịch qua chat</button>}{actionType==="BOOKING_DONE"&&<button onClick={goToMyAppointments} style={{fontFamily:bodyFont,color:C.success,background:"rgba(18,183,106,.08)"}} className="w-full py-2.5 rounded-xl text-xs font-bold mb-2">Xem lịch của tôi{lastMeta.action.appointmentCode?` – ${lastMeta.action.appointmentCode}`:""}</button>}<div className="flex gap-2"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Ví dụ: đặt lịch cắt tóc ngày mai 14h" className="flex-1 px-3.5 py-2.5 rounded-full text-sm" style={{fontFamily:bodyFont,border:`1px solid ${C.line}`}}/><button onClick={send} disabled={loading} style={{background:gradWarm}} className="w-10 h-10 rounded-full flex items-center justify-center disabled:opacity-50"><Send size={15} color="#fff"/></button></div></div></div>}</>;
}

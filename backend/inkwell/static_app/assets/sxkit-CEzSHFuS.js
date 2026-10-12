import{h as t}from"./index-DVUjCHVc.js";import{avatarUrl as i}from"./sync-D27dREfz.js";const n=`
.sx{color:var(--text,#1c1c1e);font:inherit;display:grid;gap:14px;width:100%}.sx *{box-sizing:border-box}
.sx-card{background:var(--surface,#fff);border:1px solid var(--border,rgba(0,0,0,.1));border-radius:var(--radius,14px);padding:16px;display:grid;gap:12px;box-shadow:var(--shadow-1,none)}
.sx h2,.sx h3{margin:0}.sx h3{font-size:1rem}.sx p{margin:0;color:var(--muted,#8e8e93);font-size:.875rem;line-height:1.45}
.sx label{display:grid;gap:4px;font-size:.78rem;color:var(--muted,#8e8e93)}
.sx input[type=text],.sx input[type=password],.sx input[type=email],.sx input[type=url],.sx input[type=number],.sx input[type=search],.sx input[type=datetime-local],.sx select,.sx textarea{width:100%;min-height:44px;padding:10px 12px;border-radius:10px;border:1px solid var(--border,rgba(0,0,0,.14));background:var(--surface-2,#f2f2f7);color:var(--text,#1c1c1e);font:inherit}
.sx input:focus-visible,.sx button:focus-visible,.sx select:focus-visible{outline:2px solid var(--accent,#ff9f0a);outline-offset:2px}
.sx-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.sx-grow{flex:1 1 160px}
.sx-btn{min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--border,rgba(0,0,0,.14));background:var(--surface,#fff);color:var(--text,#1c1c1e);font:inherit;cursor:pointer}
.sx-btn.sm{min-height:34px;padding:0 10px;font-size:.82rem}.sx-btn.primary{background:var(--accent,#ff9f0a);border-color:transparent;color:var(--on-accent,#fff);font-weight:600}
.sx-btn.danger{color:var(--danger,#ff3b30);border-color:currentColor}.sx-btn[disabled]{opacity:.5;cursor:default}
.sx-tabs{display:flex;gap:4px;background:var(--surface-2,#f2f2f7);border-radius:10px;padding:3px;overflow-x:auto}
.sx-tabs button{flex:1 0 auto;min-height:36px;padding:0 12px;border:0;border-radius:8px;background:none;color:var(--muted,#8e8e93);font:inherit;cursor:pointer;white-space:nowrap}
.sx-tabs button[aria-selected=true]{background:var(--surface,#fff);color:var(--text,#1c1c1e);box-shadow:var(--shadow-1,0 1px 3px rgba(0,0,0,.12))}
.sx-err{color:var(--danger,#ff3b30);font-size:.85rem}.sx-ok{color:var(--ok,#248a3d);font-size:.85rem}
.sx-warn{background:color-mix(in srgb,var(--warn,#c77700) 14%,transparent);border:1px solid color-mix(in srgb,var(--warn,#c77700) 45%,transparent);border-radius:10px;padding:10px 12px;font-size:.82rem}
.sx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.sx-stat{background:var(--surface-2,#f2f2f7);border-radius:10px;padding:10px 12px}.sx-stat b{display:block;font-size:1.15rem}.sx-stat span{font-size:.74rem;color:var(--muted,#8e8e93)}
.sx-badge{display:inline-flex;align-items:center;gap:6px;font-size:.76rem;padding:2px 9px;border-radius:99px;background:var(--surface-2,#f2f2f7);white-space:nowrap}
.sx-badge.ok{color:var(--ok,#248a3d)}.sx-badge.bad{color:var(--danger,#ff3b30)}.sx-badge.warn{color:var(--warn,#c77700)}
.sx-av{border-radius:50%;display:inline-grid;place-items:center;color:#fff;font-weight:600;overflow:hidden;flex:none;background-size:cover;background-position:center}
.sx-list>div{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--border,rgba(0,0,0,.08))}.sx-list>div:first-child{border-top:0}
.sx-list small{display:block;color:var(--muted,#8e8e93)}
.sx-table{width:100%;border-collapse:separate;border-spacing:0;font-size:.84rem}.sx-tw{overflow:auto;max-height:60vh;border:1px solid var(--border,rgba(0,0,0,.1));border-radius:10px}
.sx-table th{position:sticky;top:0;background:var(--surface-2,#f2f2f7);text-align:left;padding:8px 10px;font-weight:600;white-space:nowrap;z-index:1}
.sx-table td{padding:8px 10px;border-top:1px solid var(--border,rgba(0,0,0,.08));vertical-align:middle}.sx-table tr:hover td{background:color-mix(in srgb,var(--accent,#ff9f0a) 6%,transparent)}
.sx-center{min-height:100%;display:grid;place-items:center;padding:24px 16px}.sx-narrow{max-width:420px;margin:0 auto;width:100%}
.sx-brand{display:flex;align-items:center;gap:10px;justify-content:center;font-size:1.4rem;font-weight:700;margin-bottom:6px}
.sx-hp{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}
.sx-spark{width:100%;height:56px}
`;function l(){document.getElementById("sx-style")||document.head.append(t("style",{id:"sx-style"},n))}const d=(r="?")=>(r.trim().split(/\s+/).map(e=>e[0]).slice(0,2).join("")||"?").toUpperCase();function p(r=""){let e=0;for(const a of r)e=e*31+a.charCodeAt(0)>>>0;return`hsl(${e%360} 55% 48%)`}function f(r,e=32){const a=r?.name||r?.displayName||r?.email||"?",o=t("span",{class:"sx-av",style:{width:e+"px",height:e+"px",fontSize:Math.round(e*.4)+"px",background:p(r?.id||a)},title:a,"aria-label":a},d(a));return r?.avatar&&i(r.avatar).then(s=>{s&&(o.textContent="",o.style.backgroundImage=`url(${s})`)}),o}const g=(r,e={})=>{const a=t(e.tag||"input",e);return[t("label",{},r,a),a]},b=(r=0)=>r<1024?r+" B":r<1048576?(r/1024).toFixed(1)+" KB":r<1073741824?(r/1048576).toFixed(1)+" MB":(r/1073741824).toFixed(2)+" GB",u=r=>{if(!r)return"never";const e=Math.round((Date.now()-new Date(r).getTime())/1e3);return e<10?"just now":e<60?e+"s ago":e<3600?Math.round(e/60)+" min ago":e<86400?Math.round(e/3600)+" h ago":new Date(r).toLocaleDateString()},h=r=>r?.name==="TypeError"?"Cannot reach the server. Check the address and your connection.":r?.message||String(r),m=r=>typeof r=="string"&&/^\/(?!\/)[\w\-./%?=&]*$/.test(r)&&!r.startsWith("/auth")?r:"/";export{f as a,u as b,b as c,h as d,l as e,g as f,m as s};

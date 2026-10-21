const {test,expect}=require("@playwright/test");
const api="https://xdsblwbujxizqipgsaik.supabase.co/functions/v1/";
const visitor="55555555-5555-4555-8555-555555555555";
const bearer="A".repeat(43);
async function mock(page,deny=false){
  const audit={challenges:0,bootstraps:[],history:[],rejectRestore:false};
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js**",route=>{
    audit.challenges++;
    return route.fulfill({status:200,contentType:"text/javascript",body:"globalThis.turnstile={render(el,options){this.callback=options.callback;return 1},execute(){Promise.resolve().then(()=>this.callback('synthetic-challenge'))},remove(){}};"});
  });
  await page.route(api+"**",async route=>{
    const req=route.request(), path=new URL(req.url()).pathname.split("/").pop();
    const headers={"access-control-allow-origin":"*","access-control-allow-methods":"GET, POST, OPTIONS","access-control-allow-headers":"content-type, x-wraya-browser-session","content-type":"application/json"};
    if(req.method()==="OPTIONS")return route.fulfill({status:204,headers});
    let body={ok:true},status=200;
    if(path==="wsa-wraya-web-chat"&&req.method()==="GET")
      body={ok:true,site:{business_name:"Synthetic Business",site_name:"Synthetic Site",copy_config:{assistant_name:"Wraya",identity_recognition_enabled:false},theme_config:{},max_input_chars:4000,photo_upload:{enabled:false},turnstile:{required:true,site_key:"synthetic-site-key"}}};
    else if(path==="wsa-wraya-web-chat"&&req.method()==="POST"){
      const data=req.postDataJSON();
      if(data.operation!=="browser_session_bootstrap")throw Error("No customer-facing chat requests allowed in this isolated test");
      audit.bootstraps.push({data,headers:req.headers()});
      const restored=data.visitor_id===visitor&&req.headers()["x-wraya-browser-session"]===bearer;
      if(deny){status=403;body={ok:false,error:"bot_check_failed"};}
      else if(restored&&audit.rejectRestore&&!data.turnstile_token){status=403;body={ok:false,error:"browser_credential_invalid"};}
      else if(data.turnstile_token==="synthetic-challenge"&&audit.rejectRestore)
        body={ok:true,visitor_id:"66666666-6666-4666-8666-666666666666",browser_session_token:"B".repeat(43),restored:false};
      else if(restored||data.turnstile_token==="synthetic-challenge")
        body={ok:true,visitor_id:visitor,browser_session_token:bearer,restored};
      else{status=403;body={ok:false,error:"bot_check_failed"};}
    }
    else if(path==="wsa-wraya-web-chat-history"&&req.method()==="POST"){
      audit.history.push({body:req.postDataJSON(),headers:req.headers(),url:req.url()});
      body={ok:true,messages:[],session_id:null};
    }
    else if(path==="wsa-wraya-web-lead"&&req.method()==="GET"){
      body={ok:true,compliance:{chat_notice:"Do not send passwords.",privacy_url:"https://walkersystems.tech/privacy.html",terms_url:"https://walkersystems.tech/terms.html"}};
    }
    else throw Error("Unexpected backend request blocked: "+path+" "+req.method());
    return route.fulfill({status,headers,body:JSON.stringify(body)});
  });
  return audit;
}
test("FAQ and mobile menu work without challenging passive website visitors",async({page})=>{
  const a=await mock(page);
  await page.goto("/");
  const launcher=page.locator("wsa-wraya-chat").locator(".launcher");
  await expect(launcher).toBeVisible();
  expect(a.challenges).toBe(0);
  expect(a.bootstraps).toHaveLength(0);
  await page.locator(".faq-question").nth(1).click();
  await expect(page.locator(".faq-question").nth(1)).toHaveAttribute("aria-expanded","true");
  await page.setViewportSize({width:390,height:844});
  await page.locator("#hamburger").click();
  await expect(page.locator("#hamburger")).toHaveAttribute("aria-expanded","true");
  await page.locator("#mobileMenu a").first().click();
  await expect(page.locator("#hamburger")).toHaveAttribute("aria-expanded","false");
  expect(a.challenges).toBe(0);
});
test("Opening chat enforces challenge and private history POST; refresh restores",async({page})=>{
  const a=await mock(page);
  await page.goto("/");
  const widget=page.locator("wsa-wraya-chat");
  await widget.locator(".launcher").click();
  await expect(widget.locator("textarea")).toBeEnabled();
  await expect.poll(()=>a.history.length).toBe(1);
  expect(a.challenges).toBe(1);
  expect(a.bootstraps[0].data.turnstile_token).toBe("synthetic-challenge");
  expect(a.history[0].body.visitor_id).toBe(visitor);
  expect(a.history[0].headers["x-wraya-browser-session"]).toBe(bearer);
  expect(a.history[0].url).not.toContain("visitor_id=");
  await page.reload();
  await widget.locator(".launcher").click();
  await expect(widget.locator("textarea")).toBeEnabled();
  await expect.poll(()=>a.bootstraps.length).toBe(2);
  expect(a.bootstraps[1].headers["x-wraya-browser-session"]).toBe(bearer);
  expect(a.bootstraps[1].data.visitor_id).toBe(visitor);
  expect(a.challenges).toBe(1);
});
test("Rejected bot validation fails closed and never enables the composer",async({page})=>{
  const a=await mock(page,true);
  await page.goto("/");
  const widget=page.locator("wsa-wraya-chat");
  await widget.locator(".launcher").click();
  await expect(widget.locator(".composer-status")).toContainText("Secure chat is temporarily unavailable");
  await expect(widget.locator("textarea")).toBeDisabled();
  expect(a.history).toHaveLength(0);
});

test("Expired browser proof is not silently restored; new proof requires challenge and new visitor",async({page})=>{
  const audit=await mock(page);
  await page.goto("/");
  const widget=page.locator("wsa-wraya-chat");
  await widget.locator(".launcher").click();
  await expect(widget.locator("textarea")).toBeEnabled();
  expect(audit.challenges).toBe(1);
  audit.rejectRestore=true; // mock an expired/revoked backend proof
  await page.reload();
  await widget.locator(".launcher").click();
  await expect(widget.locator("textarea")).toBeEnabled();
  await expect.poll(()=>audit.bootstraps.length).toBe(3);
  expect(audit.bootstraps[1].data.visitor_id).toBe(visitor);
  expect(audit.bootstraps[1].headers["x-wraya-browser-session"]).toBe(bearer);
  expect(audit.bootstraps[2].data.turnstile_token).toBe("synthetic-challenge");
  expect(audit.challenges).toBe(2);
  const stored=await page.evaluate(()=>{
    const key=Object.keys(localStorage).find(k=>k.includes("browser_credential"));
    return key?JSON.parse(localStorage.getItem(key)):null;
  });
  expect(stored.visitor_id).toBe("66666666-6666-4666-8666-666666666666");
  expect(stored.session_token).toBe("B".repeat(43));
  await expect.poll(()=>audit.history.length).toBe(2);
  expect(audit.history[1].body.visitor_id).toBe(stored.visitor_id);
});

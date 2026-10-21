const {test,expect}=require("@playwright/test");
const API="https://xdsblwbujxizqipgsaik.supabase.co/functions/v1/wsa-wraya-web-identity";
const TOKEN="Z".repeat(43);

test("verification page does not redeem an email token until user confirms",async({page})=>{
  const requests=[];
  await page.route(API,async route=>{
    requests.push({method:route.request().method(),data:route.request().postData()});
    await route.fulfill({status:200,headers:{"access-control-allow-origin":"*","content-type":"application/json"},body:JSON.stringify({ok:true,status:"verified"})});
  });
  await page.goto("/verify-email.html#token="+TOKEN);
  await expect(page.getByRole("heading",{name:"Confirm your email"})).toBeVisible();
  await expect(page.locator("#confirm")).toBeEnabled();
  expect(requests).toHaveLength(0);
  expect(new URL(page.url()).hash).toBe("");
  await page.locator("#confirm").click();
  await expect(page.locator("#result")).toContainText("Email verified");
  await expect(page.locator("#confirm")).toBeHidden();
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe("POST");
  expect(new URLSearchParams(requests[0].data).get("verification_token")).toBe(TOKEN);
  expect(requests[0].data).not.toContain("email=");
});

test("missing or malformed email token remains disabled with no API calls",async({page})=>{
  const calls=[];
  await page.route(API,route=>{calls.push(route.request());route.abort()});
  await page.goto("/verify-email.html#token="+encodeURIComponent("<script>alert(1)</script>"));
  await expect(page.locator("#confirm")).toBeDisabled();
  await expect(page.locator("#result")).toContainText("missing or invalid");
  expect(calls).toHaveLength(0);
  expect(new URL(page.url()).hash).toBe("");
});

test("expired or replayed confirmation displays an error without silently retrying",async({page})=>{
  let attempts=0;
  await page.route(API,async route=>{
    attempts++;
    await route.fulfill({status:400,headers:{"access-control-allow-origin":"*","content-type":"application/json"},body:JSON.stringify({ok:false,status:"already_used"})});
  });
  await page.goto("/verify-email.html#token="+TOKEN);
  await page.locator("#confirm").click();
  await expect(page.locator("#result")).toContainText("no longer valid");
  await expect(page.locator("#confirm")).toBeDisabled();
  expect(attempts).toBe(1);
});

const {defineConfig}=require("@playwright/test");
const path=require("node:path");
module.exports=defineConfig({
 testDir:"./tests",timeout:30000,expect:{timeout:10000},
 use:{baseURL:"http://127.0.0.1:8765",browserName:"chromium",headless:true},
 webServer:{command:"python3 -m http.server 8765 --bind 127.0.0.1",cwd:path.resolve(__dirname,"../.."),url:"http://127.0.0.1:8765/",timeout:20000,reuseExistingServer:false},
 forbidOnly:true,retries:0,workers:1
});

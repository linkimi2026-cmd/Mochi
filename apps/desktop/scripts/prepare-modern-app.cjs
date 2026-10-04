"use strict";
const {existsSync,readFileSync,writeFileSync,mkdirSync,cpSync,rmSync,lstatSync}=require("node:fs");
const {join,resolve}=require("node:path");

/** electron-builder's two-package structure keeps the old Host out of app.asar. */
function prepareModernApp(desktopRoot){
  const root=resolve(desktopRoot),output=join(root,".mochi-modern-app.nosync"),marker=join(output,".mochi-modern-app-marker");
  if(existsSync(output)){
    if(lstatSync(output).isSymbolicLink()||!existsSync(marker)||readFileSync(marker,"utf8")!=="mochi-modern-app-v1\n")throw new Error("拒绝覆盖非受管App暂存目录。");
    rmSync(output,{recursive:true});
  }
  const metadata=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));
  const yamlRoot=join(root,"node_modules","yaml"),yaml=JSON.parse(readFileSync(join(yamlRoot,"package.json"),"utf8"));
  if(yaml.version!=="2.9.0"||Object.keys(yaml.dependencies??{}).length)throw new Error("桌面壳yaml版本或依赖发生变化，请重新审查。");
  mkdirSync(output,{recursive:true});writeFileSync(marker,"mochi-modern-app-v1\n");
  cpSync(join(root,"dist-electron"),join(output,"dist-electron"),{recursive:true});
  cpSync(join(root,"build"),join(output,"build"),{recursive:true});
  mkdirSync(join(output,"node_modules"),{recursive:true});cpSync(yamlRoot,join(output,"node_modules","yaml"),{recursive:true,dereference:true});
  const {name,version,description,main,author}=metadata;
  writeFileSync(join(output,"package.json"),JSON.stringify({name,version,description,main,author,private:true,dependencies:{yaml:yaml.version}},null,2)+"\n");
  return output;
}
module.exports={prepareModernApp};

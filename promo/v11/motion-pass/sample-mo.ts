import {BotEngine} from '../../../client-plugins/jxl-brand/src/vendor/bloub/engine';
import type {StateId} from '../../../client-plugins/jxl-brand/src/vendor/bloub/states';
const cues:Array<[number,StateId]>=[[.5,'wide'],[1.4,'idle'],[3.4,'wink'],[4.8,'idle']];
export function sampleMoFrame(t:number,turn=0){
 const engine=new BotEngine(100,'idle');
 for(const [at,state]of cues)if(t>=at)engine.setState(state,at);
 // Use the product's nonzero gaze easing, including on the exact first frame.
 engine.setLook({yaw:turn,pitch:6,mix:1,spin:0,wander:.08},0);
 return engine.sample(t);
}

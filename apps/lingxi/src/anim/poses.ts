// Rest-relative offsets. Full-body clips blend these reusable poses through JSON tracks.
//
// The `.rotation.z` terms on the hind legs are a SPLAY: as the leg folds up, it also swings
// slightly away from the midline so it tucks BESIDE the body rather than into it. Without it
// the shin ends up inside the pelvis - measured at 2.7-3.8 voxels of interpenetration across
// every sitting, loafing and rolling clip (probe-clips.html), which is the "有些动作会穿模"
// report. It is also simply what a real cat does: the hind feet come down outside the hips,
// not under the spine.
//
// Sign: the rig faces +z (toward the viewer) with +y up, so the cat's own left is +x - and a
// positive rotation.z swings a downward-pointing bone's tip toward +x. Splaying out is
// therefore POSITIVE on the left leg and negative on the right. (Getting this backwards folds
// the legs further into the body and makes the clipping worse, which the probe caught.)
export const POSES:Record<string,Record<string,number>>={
  sit:{'hipC.rotation.x':-.25,'thighL.rotation.x':-1.05,'thighR.rotation.x':-1.05,'thighL.rotation.z':.2,'thighR.rotation.z':-.2,'shinL.rotation.x':.85,'shinR.rotation.x':.85,'footL.rotation.x':-.35,'footR.rotation.x':-.35,'spine1.rotation.x':-.12,'head.rotation.x':.22,'tail0.rotation.y':.48,'tail1.rotation.y':.32},
  crouch:{'upperFL.rotation.x':-.55,'upperFR.rotation.x':-.55,'lowerFL.rotation.x':1.1,'lowerFR.rotation.x':1.1,'thighL.rotation.x':-.55,'thighR.rotation.x':-.55,'shinL.rotation.x':.8,'shinR.rotation.x':.8,'head.rotation.x':-.12},
  loaf:{'upperFL.rotation.x':-1.1,'upperFR.rotation.x':-1.1,'lowerFL.rotation.x':1.7,'lowerFR.rotation.x':1.7,'thighL.rotation.x':-1.3,'thighR.rotation.x':-1.3,'thighL.rotation.z':.22,'thighR.rotation.z':-.22,'shinL.rotation.x':1.25,'shinR.rotation.x':1.25,'footL.rotation.x':-.4,'footR.rotation.x':-.4,'head.rotation.x':.08,'tail0.rotation.y':.72,'tail1.rotation.y':.5,'tail2.rotation.y':.4},
  tuck:{'upperFL.rotation.x':-1.15,'upperFR.rotation.x':-1.15,'lowerFL.rotation.x':1.65,'lowerFR.rotation.x':1.65,'thighL.rotation.x':-1.2,'thighR.rotation.x':-1.2,'thighL.rotation.z':.26,'thighR.rotation.z':-.26,'shinL.rotation.x':1.2,'shinR.rotation.x':1.2,'footL.rotation.x':-.5,'footR.rotation.x':-.5,'tail0.rotation.x':-.35,'tail1.rotation.x':-.25},
  stretch:{'hipC.rotation.x':.25,'spine2.rotation.x':.18,'spine1.rotation.x':.16,'upperFL.rotation.x':-1.0,'upperFR.rotation.x':-1.0,'lowerFL.rotation.x':-.25,'lowerFR.rotation.x':-.25,'head.rotation.x':-.2,'tail0.rotation.x':.2},
  curl:{'thighL.rotation.z':.2,'thighR.rotation.z':-.2,'spine3.rotation.y':.28,'spine2.rotation.y':.36,'spine1.rotation.y':.25,'neck1.rotation.y':-.45,'head.rotation.y':-.35,'head.rotation.x':.25,'tail0.rotation.y':.7,'tail1.rotation.y':.55,'tail2.rotation.y':.35},
};

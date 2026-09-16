/** Rest-relative offsets. Full-body clips blend these reusable poses through JSON tracks. */
export const POSES:Record<string,Record<string,number>>={
  sit:{'hipC.rotation.x':-.25,'thighL.rotation.x':-1.05,'thighR.rotation.x':-1.05,'shinL.rotation.x':.85,'shinR.rotation.x':.85,'footL.rotation.x':-.35,'footR.rotation.x':-.35,'spine1.rotation.x':-.12,'head.rotation.x':.22,'tail0.rotation.y':.48,'tail1.rotation.y':.32},
  crouch:{'upperFL.rotation.x':-.55,'upperFR.rotation.x':-.55,'lowerFL.rotation.x':1.1,'lowerFR.rotation.x':1.1,'thighL.rotation.x':-.55,'thighR.rotation.x':-.55,'shinL.rotation.x':.8,'shinR.rotation.x':.8,'head.rotation.x':-.12},
  loaf:{'upperFL.rotation.x':-1.1,'upperFR.rotation.x':-1.1,'lowerFL.rotation.x':1.7,'lowerFR.rotation.x':1.7,'thighL.rotation.x':-1.3,'thighR.rotation.x':-1.3,'shinL.rotation.x':1.25,'shinR.rotation.x':1.25,'footL.rotation.x':-.4,'footR.rotation.x':-.4,'head.rotation.x':.08,'tail0.rotation.y':.72,'tail1.rotation.y':.5,'tail2.rotation.y':.4},
  tuck:{'upperFL.rotation.x':-1.15,'upperFR.rotation.x':-1.15,'lowerFL.rotation.x':1.65,'lowerFR.rotation.x':1.65,'thighL.rotation.x':-1.2,'thighR.rotation.x':-1.2,'shinL.rotation.x':1.2,'shinR.rotation.x':1.2,'footL.rotation.x':-.5,'footR.rotation.x':-.5,'tail0.rotation.x':-.35,'tail1.rotation.x':-.25},
  stretch:{'hipC.rotation.x':.25,'spine2.rotation.x':.18,'spine1.rotation.x':.16,'upperFL.rotation.x':-1.0,'upperFR.rotation.x':-1.0,'lowerFL.rotation.x':-.25,'lowerFR.rotation.x':-.25,'head.rotation.x':-.2,'tail0.rotation.x':.2},
  curl:{'spine3.rotation.y':.28,'spine2.rotation.y':.36,'spine1.rotation.y':.25,'neck1.rotation.y':-.45,'head.rotation.y':-.35,'head.rotation.x':.25,'tail0.rotation.y':.7,'tail1.rotation.y':.55,'tail2.rotation.y':.35},
};

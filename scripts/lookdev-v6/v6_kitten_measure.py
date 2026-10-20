# Round ZZS. Kitten-proportion metrics on side renders in dir $1 (stand-side / sit-side / liedown-side .png), same measures as the codex kitten targets.
# stand-side, in units of the fore-hind leg spacing L: height, crown over the back at mid-body, body depth there, belly clearance, nose ahead of the foreleg.
# sit / liedown: crown over the rear hump and the rear hump's height, as fractions of the total height.
import sys, numpy as np
# Usage: python3 v6_kitten_measure.py DIR... (a dir holding stand-side / sit-side / liedown-side .png; a dir named 'tgt' is a codex target).
# The leg-spacing unit (stand) proved unreliable between bald and furred renders, and stand()'s depth / clearance break when the
# mid-body column crosses a mask gap (the white belly) - prefer torso(), in units of the standing height, and check by eye.
from PIL import Image, ImageFilter
def mask(p, ours=True):
    raw=Image.open(p).convert('RGBA').resize((420,420)); rgba=np.asarray(raw); a=rgba[:,:,:3].astype(float); H,W,_=a.shape
    if ours and rgba[:,:,3].min()<255:
        alpha=Image.fromarray(rgba[:,:,3]).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
        return np.asarray(alpha)>127   # an alpha render keeps the photographed floor and contact shadow out of the silhouette
    mx=a.max(2); mn=a.min(2); sat=(mx-mn)/np.maximum(mx,1); bri=a.mean(2)
    bg=np.median(np.concatenate([a[:H//10,:W//10].reshape(-1,3),a[:H//10,-W//10:].reshape(-1,3)]),0)
    m=(sat>.20)|(bri>bg.mean()+30)|(np.linalg.norm(a-bg,axis=2)>45)
    if ours: m[bri<25]=False
    mi=Image.fromarray((m*255).astype('uint8')).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    return np.asarray(mi)>128
def stand(m):
    H,W=m.shape; cols=np.where(m.any(0))[0]
    top=np.array([np.argmax(m[:,x]) if m[:,x].any() else 10**6 for x in range(W)]); bot=np.array([H-1-np.argmax(m[::-1,x]) if m[:,x].any() else -1 for x in range(W)])
    floor=bot.max(); legs=[x for x in cols if bot[x]>=floor-6]; cl=[[legs[0]]]
    for x in legs[1:]: (cl[-1].append(x) if x-cl[-1][-1]<=4 else cl.append([x]))
    cl=[c for c in cl if len(c)>=4]; f,h=cl[0],cl[-1]; L=np.mean(h)-np.mean(f); mid=int((f[-1]+h[0])/2)
    col=m[:,mid]; y0=np.argmax(col); y1=y0+np.argmax(~col[y0:]); crown=top[cols].min()
    return dict(height=(floor-crown)/L, crown_over_back=(top[mid]-crown)/L, depth=(y1-y0)/L, clearance=(floor-y1)/L, nose_ahead=(f[0]-cols.min())/L)
def rest(m):
    H,W=m.shape; cols=np.where(m.any(0))[0]; x0,x1=cols.min(),cols.max(); w=x1-x0
    top=np.array([np.argmax(m[:,x]) if m[:,x].any() else 10**6 for x in range(W)]); floor=max(H-1-np.argmax(m[::-1,x]) for x in cols)
    crown=top[x0:x0+int(.40*w)].min(); hump=top[x0+int(.55*w):x1].min(); h=floor-crown
    return dict(h_over_w=h/w, crown_over_hump=(hump-crown)/h, hump=(floor-hump)/h)
def torso(d, ours=True):
    m=mask(f'{d}/stand-side.png',ours); H,W=m.shape; cols=np.where(m.any(0))[0]
    top=np.array([np.argmax(m[:,x]) if m[:,x].any() else 10**6 for x in range(W)]); bot=np.array([H-1-np.argmax(m[::-1,x]) if m[:,x].any() else -1 for x in range(W)])
    floor=bot.max(); crown=top[cols].min(); h=floor-crown
    legs=[x for x in cols if bot[x]>=floor-6]; mid=int((legs[0]+legs[-1])/2)
    col=m[:,mid]; y0=np.argmax(col); y1=y0+np.argmax(~col[y0:]); out=[]
    for fr in (.4,.5,.6):
        xs=np.where(m[int(y0+fr*(y1-y0))])[0]; runs=np.split(xs,np.where(np.diff(xs)>12)[0]+1); run=[r for r in runs if r[0]<=mid<=r[-1]]
        out.append((run[0][-1]-run[0][0])/h)
    return dict(torso=round(float(np.mean(out)),3), spread=round((legs[-1]-legs[0])/h,3), depth=round((y1-y0)/h,3), clearance=round((floor-y1)/h,3), crown_over_back=round((top[mid]-crown)/h,3))
if __name__=='__main__':
    import sys
    for d in sys.argv[1:]:
        ours='tgt' not in d; out={}
        for k,fn in (('stand',stand),('sit',rest),('lie',rest)):
            p=f"{d}/{dict(stand='stand-side',sit='sit-side',lie='liedown-side')[k]}.png"
            try: out[k]={a:round(float(b),2) for a,b in fn(mask(p,ours)).items()}
            except Exception as e: out[k]=str(e)
        print(d, out, torso(d, ours))

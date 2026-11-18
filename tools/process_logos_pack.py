import numpy as np
from PIL import Image
from scipy import ndimage
B="/mnt/user-data/uploads/Historical NBA GM Game/Team logos/Assets/sportslogos_nba/"
OUT="/home/claude/historical-nba-gm/public/assets/logos/"
M={'ATL-1995':'Atlanta Hawks/Primary Logos/1995-96_2006-07_kqhjtzl2ik3gnxsnwsn8yf002.png',
'ATL-2007':'Atlanta Hawks/Primary Logos/2007-08_2014-15_5mdhgjh3aa92kih09pgi.png',
'ATL':'Atlanta Hawks/Primary Logos/1972-73_1994-95_au67znem99jyg6d7esach62e4.png',
'BOS-1996':'Boston Celtics/Primary Logos/1996-97_Present_slhg02hbef3j1ov4lsnwyol5o.png',
'NJN-1990':'Brooklyn Nets/Primary Dark Logos/1990-91_1996-97_21567311991.png',
'NJN-1997':'Brooklyn Nets/Primary Dark Logos/1997-98_2011-12_21573041998.png',
'CLE-1983':'Cleveland Cavaliers/Primary Logos/1983-84_1993-94_qg1w8t0t6ol9f7sbhv4j3s0s1.png',
'CLE-1994':'Cleveland Cavaliers/Primary Logos/1994-95_2002-03_faemq40pf86689pq4z8550l5i.png',
'CLE-2003':'Cleveland Cavaliers/Primary Logos/2003-04_2009-10_5zp5356wfntqosqr3ah5hmdr1.png',
'CLE-2010':'Cleveland Cavaliers/Primary Logos/2010-11_2016-17_e4701g88mmn7ehz2baynbs6e0.png',
'DAL':'Dallas Mavericks/Alternate Logos/1980-81_2000-01_aa65jz06hggyuale7xmkeefka.png',
'DAL-1993':'Dallas Mavericks/Primary Logos/1993-94_2000-01_9bjmx5zlk506mle5slggyeepe.png',
'DAL-2001':'Dallas Mavericks/Primary Logos/2001-02_2016-17_ifk08eam05rwxr3yhol3whdcm.png',
}
def clean(im):
    a=np.array(im.convert('RGBA')).astype(int)
    h,w,_=a.shape
    seeds=[]
    for (y0,x0,dy,dx) in [(0,0,1,1),(0,w-1,1,-1),(h-1,0,-1,1),(h-1,w-1,-1,-1)]:
        y,x=y0,x0
        while 0<=y<h and 0<=x<w and a[y,x,3]<200: y+=dy; x+=dx
        if 0<=y<h and 0<=x<w: seeds.append((y,x))
    cols=[a[y,x,:3] for y,x in seeds]
    if len(cols)>=3 and all(np.abs(c-cols[0]).sum()<45 for c in cols):
        diff=np.abs(a[:,:,:3]-cols[0]).sum(axis=2)
        near=(diff<28)&(a[:,:,3]>0)
        lab,n=ndimage.label(near)
        ids=[lab[y,x] for y,x in seeds if lab[y,x]>0]
        bg=np.isin(lab,ids)
        a[bg,3]=0
        edge=ndimage.binary_dilation(bg,iterations=1)&~bg
        a[edge,3]=(a[edge,3]*np.clip(diff[edge]/110,0.3,1)).astype(int)
    alpha=a[:,:,3]>30
    lab,n=ndimage.label(alpha)
    if n>1:
        sizes=ndimage.sum(alpha,lab,range(1,n+1))
        big=sizes.max()
        for i,sz in enumerate(sizes,1):
            if sz<big*0.012: a[lab==i,3]=0
        tot=sizes.sum()
        cms=ndimage.center_of_mass(alpha,lab,range(1,n+1))
        for i,(sz,(cy,cx)) in enumerate(zip(sizes,cms),1):
            if sz<tot*0.03 and cx>w*0.84 and cy>h*0.6: a[lab==i,3]=0
    return Image.fromarray(a.astype('uint8'))
for k,f in M.items():
    im=clean(Image.open(B+f))
    if k.startswith('NJN'): im=clean(clean(im))
    bb=im.getbbox(); im=im.crop(bb)
    a=np.array(im); al=a[:,:,3]>30; lab,n=ndimage.label(al)
    if n>1 and k.startswith('NJN'):
        sz=ndimage.sum(al,lab,range(1,n+1)); cm=ndimage.center_of_mass(al,lab,range(1,n+1)); H,Wd=al.shape
        for i,(z,(cy,cx)) in enumerate(zip(sz,cm),1):
            if z<sz.sum()*0.05 and cx>Wd*0.8 and cy>H*0.55: a[lab==i,3]=0
        im=Image.fromarray(a); im=im.crop(im.getbbox())
    w,h=im.size; s=max(w,h); can=Image.new('RGBA',(s,s),(0,0,0,0)); can.paste(im,((s-w)//2,(s-h)//2))
    can.resize((256,256),Image.LANCZOS).save(OUT+k+'.png',optimize=True)
    print(k)

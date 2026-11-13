# Builds a sample door-jamb VIN label (sample VIN, Code 39 with the leading I) used as the fake camera in shoot.js
import sys, subprocess
from PIL import Image, ImageDraw, ImageFont
P={'0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw','5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
'A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn','F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn',
'K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','P':'nnwnwnnwn','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn',
'U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn','Z':'nwwnwnnnn','*':'nwnnwnwnn'}
VIN="WP1AA2A59RLB12345"
W,H=1280,720
img=Image.new('RGB',(W,H),(58,60,64)); d=ImageDraw.Draw(img)
d.rounded_rectangle([50,170,W-50,H-150],18,fill=(246,246,242))
try: f=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',30); s=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',22)
except: f=s=ImageFont.load_default()
n,w=3,9; x=x0=(W-19*(3*w+6*n+n))//2
for ch in '*I'+VIN+'*':
    for i,e in enumerate(P[ch]):
        ww=w if e=='w' else n
        if i%2==0: d.rectangle([x,200,x+ww-1,420],fill=(0,0,0))
        x+=ww
    x+=n
d.text((x0,440),"VIN  "+VIN,font=f,fill=(10,10,10))
d.text((x0,488),"SAMPLE VEHICLE LABEL",font=s,fill=(40,40,40))
img.save('label.png')
subprocess.run(['ffmpeg','-loglevel','error','-y','-i','label.png','-frames:v','1','-pix_fmt','yuv420p','label.y4m'],check=True)

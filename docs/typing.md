# Typing: the on-screen keyboard and your phone

[← Back to the README](../README.md)

## The on-screen keyboard

It comes up wherever there's something to type: search, naming things, and text boxes on websites (select one and press A, or press R3).

- **A** types the highlighted key, **X** deletes, **Y** types a space.
- **Hold L2 or R2** for capitals and symbols. Press both together for caps lock.
- **Start** is Done and **B** cancels. Both ask "are you sure?" first; Settings → Controller → On-screen keyboard can switch that off.
- **Suggestions** sit above the keys: press Up to reach them. They finish the word you're typing, and offer titles and your earlier searches. Settings → Controller → On-screen keyboard turns them off, or forgets your earlier searches.

## Typing on your phone

Wherever you can type, there's a code to scan. Scan it, and what you type on your phone goes straight to the TV. It's handy for long passwords and keys, which you can paste.

Your phone needs to be on the same Wi-Fi as the computer. The code only works on your home network, and changes every time the app starts.

**If the phone page never loads,** Settings shows a *Phone not connecting?* panel after a few seconds:

- **A firewall** may be blocking it. If your computer uses ufw or firewalld, **Allow on my home network** (press right to get to it, in the box beside the QR code) fixes it (it asks for your computer's password). It lets in your whole home network (for example every 192.168.x.x address), never the internet. The app uses port 8765, or one of the next few (up to 8774) if something else has 8765.
- To do it yourself instead: `sudo ufw allow from 192.168.0.0/16 to any port 8765:8774 proto tcp` (use `10.0.0.0/8` if your addresses start with 10).
- Otherwise, check your phone isn't on a guest network or a VPN, and that your router doesn't keep Wi-Fi devices apart ("AP isolation" or "client isolation").

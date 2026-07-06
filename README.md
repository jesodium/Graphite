# graphite

graphite is a desktop app written with electron that walks you through homebrewing your consoles step by step. pick your console, pick your model, pick a method, and follow along. graphite will automatically handle for you the process of downloading files, extracting them, placing them onto your sd card. all you have to do is the manual work on your console.

graphite is currently a work in progress.

![alt text](image.png)



# why did i create this?
i came up with this idea while modding my friend's wii u. they said they've always wanted to mod theirs but they never got past the FSGetMountSource error. they also did not know how to install apps onto their sd card. while for me it's a breeze to mod practically any console, theres people who want to but can't because they don't know how to understand the terminology like formatting sd cards, merging folders, etc. Also, the hacks.guide websites (which are great) might be a bit too complex for non-tech people.

![alt text](/docs/image-1.png)

# features
- step by step instructions for the consoles you want
- will write files for you and download them from latest official sources
- will save your nand backup onto your pc without you digging each file up.
- will make sure you have everything right before modding

![alt text](/docs/image-2.png)

# installation

download the latest release on the releases tab and run it.

if you want to run it from source:

```
git clone https://github.com/jesodium/graphite.git
cd graphite
npm install
npm start
```

# a note on ai

almost all of the guides in this project are ai generated, (paraphrased from guide sites) because lets be honest writing and testing every single step by hand for every console and method is just not feasible for me. It takes too much time and school does not give me the ability to sit down and write down these guides step by step. if a step seems off or dosent match what you saw on your console, that's why.

# pls help

if you've gone through a guide and tried it and noticed something off, please open a pull request. these fixes will help people trying to mod their consoles. the more people who help, the more trustworthy and accurate graphite becomes.

guides use a specific format written with .json, soon i'll be releasing how this works so users can start contributing.

# how to contribute

1. fork the repo
2. make your changes
3. open a pull request describing what you changed and why
4. that's it.

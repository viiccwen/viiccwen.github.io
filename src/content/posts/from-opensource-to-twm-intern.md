---
title: 從 GitHub 到 Offer：透過開源貢獻拿到實習 Offer
published: 2026-04-15
description: ''
image: '../../assets/posts/from-opensource-to-twm-intern/taiwan-mobile.webp'
tags: ['internship', 'opensource']
category: '開源貢獻'
draft: false 
lang: 'zh-tw'
---

對於多數的 CS 學生來說，找到實習最快的路，大概就是刷題、投履歷、做 side project 吧。然後在投遞了至少 50 封的履歷後，**換來的卻是一封封的 reject letter** — 這幾乎已經成為資工人的日常寫照。

<img src="https://media1.tenor.com/m/zA1Va-a2z8MAAAAd/unemployed-final.gif" width="40%" style="display: block; margin: 0 auto;"  />

但誠如標題所說，我走的是一條不太一樣的路，甚至可以說是一條相對坎坷、也更不確定的路。我沒有把時間主要投入在刷題，而是選擇投入開源專案與技術社群，從一個沒有人認識的 contributor，一步步累積實作經驗與影響力。最後，我透過這條路，拿到了台灣大哥大的 SWE Intern offer ✨。

## 故事起源

在那段時間，我其實和多數人一樣，嘗試用許多方式提升自己：維持系排、做 side project、累積相關領域知識，甚至也參與過技術社群與年會分享。但現實是，在投遞了一封又一封履歷之後，仍然只收到滿滿的 reject。那種感覺其實超級挫折，好像你明明已經做了很多，但總感覺沒有任何效果。

接觸到開源是來自於我在前一份實習中接觸到 [Apache Airflow](https://github.com/apache/airflow)（當時還沒跑到源來適你）。當時我發現了一個 bug，一開始其實也只是想像多數人一樣，開個 issue 等待回覆。但後來我開始好奇：「為什麼會有這個問題？」於是我試著自己閱讀 source code、搭配 AI 找出問題的來源，最後提交了一個 pull request，並且被成功 merge。後面也陸陸續續在 [dag-factory](https://github.com/astronomer/dag-factory/) 發了數個 PR，甚至包含 Breaking Change（非常刺激）。

<img src="https://ithelp.ithome.com.tw/upload/images/20230922/20140477Pnk77E7SOd.png" width="50%" style="display: block; margin: 0 auto;" />


開源讓我第一次感受到，自己不只是單純使用技術的人，而是可以參與其中、甚至對這個世界產生一點點影響的人 🤏。也正是從那時候開始，我開始重新思考：**也許我可以走一條不一樣的路**。

## 投入 Apache Mahout

在那之後，雖然開始做開源，但由於大三上較為忙碌，就比較少發 PR。真正的轉折點，是在朋友 Jay 的介紹下，我加入了 [Apache Mahout](https://github.com/apache/mahout) 這個 Project。

<img src="https://upload.wikimedia.org/wikipedia/commons/1/10/Apache_Mahout_Logo.png" width="50%" style="display: block; margin: 0 auto;" />

一開始其實並不順利。相較於自己過去熟悉的專案，Mahout 後來改版是在做 Quantum ML 和 GPU 平行運算，我過往根本沒接觸過這種專案，需要花更多時間理解知識背景與架構。我花了不少時間在學習相關知識和閱讀程式碼、理解 mailing list 和 Community 的討論，甚至只是為了釐清一個 issue，就需要反覆查資料與實驗。但也正是在這樣的過程中，讓我從中學習到了非常多，也是讓我開始真正接觸到「工程」而不只是「寫程式」。如何設計可維護的軟體、如何與不同背景的開發者協作、以及如何讓一段程式碼能被他人理解與接受。

隨著時間推進，我逐漸能夠穩定地提出貢獻，從小型修正到功能改善，也開始參與其他人的 PR review。到目前為止，我已經累積了 [30+ 個 PR](https://github.com/apache/mahout/pulls?q=is%3Apr+author%3Aviiccwen+) 與 [60+ 個 code review](https://github.com/apache/mahout/pulls?q=is%3Apr+reviewed-by%3Aviiccwen)，這些數字背後其實代表的是無數次的來回討論、被 challenge、以及不斷修正的過程。

## 擁抱源來適你

除了技術層面的成長，開源也讓我開始與更多社群建立 connection。我加入了[源來適你 - ALC Taipei](https://github.com/opensource4you)，一個由開源金城武掌管的神秘組織（喜歡去 Hooters 的蔡嘉平博士），裡面威震四方的大佬無數，不乏許多國際大專案的 PMC 與 Committer。當時的我只能蜷縮在角落瑟瑟發抖，並看著裡面的學長姐們在舞台上發光發熱，這裡就像是一個全新的世界 — 你會發現，原來那些平常只在 GitHub 或文件中看到的專案和維護者的名字，真實地存在於你身邊，並且大家都很願意分享經驗、交流想法。

我也開始參與這個社群不定期舉辦的開源小聚，而聚會的地點就在台灣大哥大的辦公室內。也正是在這樣的場合，我認識了 Marie（aka 台灣大哥大資訊長室經理 兼 IMA 中華民國資訊經理人協會的副秘書長）。一開始其實只是很單純的交流，分享自己的背景與正在做的事情，但在聊天的過程中，我也提到自己正在尋找實習機會。

<img src="/posts/from-opensource-to-twm-intern/taiwan-mobile-office.webp" width="45%" style="display: block; margin: 0 auto;"  />

讓我沒有想到的是，在了解我的開源經驗與投入之後，Marie 很快地幫我安排了後續的面試機會，雖然中間一波三折，但結局還是滿意的。

> 那些過去在開源中累積的那些經驗與投入，轉化為實際機會了。

## 回首過程

回頭看這段過程，我認為自己做對的，並不是單一個決定，而是幾個關鍵選擇的累積。

首先，我沒有把開源當成一個「加分項」，而是當成主要投入的方向。這代表我不是偶爾修個 bug，而是**持續地閱讀程式碼、參與討論、提出貢獻**，讓自己真正融入專案之中。

再來，我關注於系統與問題本身，而不是只追求完成任務（closed issue）。無論是在處理 bug、設計功能，或是參與 review，我都**試著去理解背後的原因與設計考量**，因此不只是怎麼寫出「正確的程式」，而是在真實環境中做出合理的 engineering decision。

最後，**讓自己的努力能夠被看見**。開源本身就是一個公開的場合，你的程式碼、討論紀錄、貢獻歷史，都是一種長期累積的證明。當機會出現時，這些內容不需要額外包裝，就能直接說明你的能力。

## 一些建議

如果你也在找實習，或者對目前的方向感到迷惘，我會給幾個建議。

第一，不一定要走最主流的路。刷題與 side project 當然重要，但它們並不是唯一的選項。如果你頭夠鐵、八字夠硬，開源提供的是另一種不同的成長方式，特別是當你希望接觸真實系統與實際問題時。

第二，從小地方開始，但要持續。第一次的貢獻可能只是文件修正或小 bug，但關鍵不是大小，而是你是否願意持續投入，並逐漸往更核心的問題前進。

第三，學會閱讀與理解他人的系統。很多人寫 code 很快，甚至 AI 幾分鐘就能完成一個專案，但不一定能理解一個大型專案的設計與演進。這種能力在開源中會被大量訓練，也是企業很看重的一點。

最後，讓自己參與社群。無論是線上討論、社群活動，或是技術分享，這些都是讓你被看見、建立 connection 的重要方式。很多機會，其實不是投履歷來的，而是透過互動自然產生的。

> 開源給我的不只是技術能力，而是一種參與世界的方式。你不再只是使用工具的人，而是可以貢獻、影響，甚至改變某些事情的人。

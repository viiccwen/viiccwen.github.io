---
title: "[SWE Internship Recap] My Time at FXG"
published: 2026-02-28
description: ""
image: "../../../assets/posts/fxg-internship-at-fxg.jpg"
tags: ["internship"]
category: "Notes & Reflections"
draft: false
lang: "en"
---

I am Vic. I recently finished my internship at my previous company, so I came back to the blog to sort out my thoughts and make room for a little reflection during a busy first week of school.

From July 2025 to February 2026, I worked at FXG as a backend software engineering intern. During the summer I was on-site, and from the middle to the later stages I switched to a hybrid schedule, going in about two days a week. It was a 40-hour workweek the whole time, so balancing work and school after classes started took some effort. Fortunately, I kept up with my coursework pretty well and even barely made the dean's list.

Recently someone asked me, "Vic, why did you decide to do an internship in the first place? Isn't it pretty nice just to slack off at home during summer?" Honestly, I thought the same thing. So why still go intern?

For me, academia and industry feel somewhat disconnected, so I really wanted to get closer to industry and see whether the development process, tech stack differences, and pace were actually what I imagined. On the other hand, I also just cannot sit still for too long, and I would feel guilty if I did nothing. So, internship it was.

## Interview process

I had already interviewed at a few startups before, all for backend roles, and those interviews mostly involved system design questions. So this one went pretty smoothly, and the conversation was pleasant too.

It started with a resume review and questions about side projects and my familiarity with different languages. That part took about five minutes to describe the project details and my role in them. Then came system design questions like, "If you need to do xxxx in one second, how would you approach it?" In other words, questions about MQ and distributed architecture. The second question was, "What is the difference between Kafka and RabbitMQ?" Since I had prepared for that, I answered smoothly, and that was how I got the offer.

## Perks

1. Flexible clock-in with a 30-minute grace period
2. Free lunch every Tuesday and afternoon tea every Thursday (I totally went there to mooch food on those two days)
3. Snacks and cookies are always available in the office, and sometimes coworkers bring food back from trips to share with everyone

## What I worked on

I mainly worked on backend tasks. In the first stage, I integrated and improved two internal tools. In the middle stage, I shifted to building data infrastructure, handling cloud-to-on-prem sync, ETL pipelines, and various automated reports. In the later stage, I moved on to optimizing monolithic architecture and microservice design.

### Early stage

Because those two internal tools sat between the Backend Team and the Data Team, I often had to shuttle between the two departments. And sometimes **people did not even know exactly what they wanted or expected**, so I had to spend a lot of time confirming details and checking whether the feature they wanted was even feasible. Some ideas were a little too wild, so my job was to narrow down requirements and plan the implementation flow. Otherwise, it would have been very easy to spend a whole day working and end up doing something completely useless.

On the technical side, I handled the table design, API design, and query optimization myself. Since the project was read-heavy, I designed 60+ APIs and iterated on them until the project was complete.

What I learned most during this stage was **the communication and analytical ability needed for cross-team collaboration**.

### Middle stage

After wrapping up the early project, I moved on to help with the Data Team's infrastructure. That included adopting ClickHouse (OLAP) as the database to reduce storage costs and improve query speed, and using Apache Airflow as the automation scheduling platform. From there, I started designing and implementing many projects on top of that foundation, working with a lot of data, SQL design, and performance tuning. It also made me realize how interesting data work can be, so this period was a genuinely fun experience.

Because I had no prior familiarity with ClickHouse or Apache Airflow, this also became the entry point that led me into the 2025 iThome Ironman challenge ([ClickHouse Series: From Database Internals to Software Practice](https://ithelp.ithome.com.tw/users/20168031/ironman/8221)) and into open source.

There was one small twist in the middle: since I was kind of winging it, my early architecture did not consider extensibility. As a result, the business logic and Airflow lived in the same repo, which made the project grow huge and caused package conflicts. So I spent a week researching and redesigning the architecture (there were surprisingly few examples online, QQ). In the end, I used `DockerOperator` as the task runtime, split the business logic into separate repos, wrapped each one as an image, and combined that with a CLI interface and CI/CD for automated version updates. That improved readability and maintainability a lot, and I am still pretty proud of it.

I also care a lot about the software development process, testing, and documentation. A project without policies will absolutely become a disaster. Back then, a new grad joined my project, and good docs helped them get up to speed quickly while keeping the team moving efficiently. That made me pretty happy.

There were also some weird upper-level situations during this stage that slowed down development, forced us to take a long detour to ship features, and gradually made the system less stable. But that was not really my problem, so I could not do much about it.

What I learned most during this stage was **architecture design, SQL writing and optimization, and how to use Airflow / ClickHouse**.

### Later stage

Once the middle-stage work stabilized and was released, I became the maintainer responsible for reviewing PRs, and my development focus shifted toward backend optimization and microservice architecture.


## What did I learn?

### Technical skills
* Technical ability (backend, data, databases...)
* Tool usage
* Industry knowledge

### Soft skills
* Cross-team communication
* Time management
* Stress tolerance
* Asking good questions

### Mindset shifts
* From student mindset to workplace mindset
* From fearing mistakes to accepting imperfection
* From passive to proactive

## Some thoughts

I originally thought both backend and data work were equally appealing, and that I wanted to try everything. But once I actually entered the industry, I found that I especially enjoy:

* The thinking process behind system architecture design
* Turning messy requirements into an implementable plan
* The sense of satisfaction that comes from performance tuning and refactoring, when things become clean again

I realized that I really like the **backend + data infra** space, especially problems involving architecture design and performance optimization.
Compared with simple CRUD, I enjoy figuring out how to make things scale.

### What do I now know I like and dislike?

This question is more important than it sounds.

**I like:**

* Projects with real ownership
* Space to design and make decisions myself
* Teams with clear documentation and processes
* Technical discussions that are rational, not emotional

**I dislike:**

* Constantly changing direction
* Taking the long way around for political reasons
* No decision-maker who can converge requirements

But those "dislikes" also made me realize that **an engineer does not just write code; they exist inside a complex organizational system**. After all, code can be optimized, but organizational problems are sometimes much harder to solve.

### A reminder for future me

1. Do not stop thinking about architecture just because you have become more experienced
2. Always keep the courage to refactor
3. Keep writing articles, organizing knowledge, and sharing with others!
4. Do not get anxious just because other people move faster

And one more thing that matters a lot:

> Do not trap yourself in the mindset of "I am just an intern."

Human growth is unlimited. Never lower your standards just because you think of yourself as "only a student."

## Advice for future interns

If you are also preparing to start an internship, here are a few sincere pieces of advice.

### What should you prepare?

**1. Build a solid foundation**

* SQL optimization concepts
* RESTful API design
* Git flow
* Basic system design concepts (MQ, caching, distributed systems)

**2. Document-reading ability**

Most of the time, the problem is not that you cannot do it. It is that you are unwilling to read the docs. Being able to look things up, debug, and trace logs by yourself matters more than anything else.

**3. Communication skills**

You will discover that technical issues are often not blocked by technology, but by unclear requirements.

### What should you know mentally?

* You will definitely make mistakes
* You will definitely write bad code
* You will definitely be challenged

But all of that is normal.

What really sets people apart is not talent, but:

> Can you systematically correct yourself after making mistakes?

### What should you absolutely not do?

* Do not only take easy tasks and hide
* Do not pretend to understand
* Do not keep quiet instead of asking
* Do not throw the problem back without your own thinking

Before asking a question, at least be able to say:

> "I tried A, B, and C, and now I am stuck at D. Does this direction make sense?"

## Closing

From July 2025 to February 2026, that period was not very long.

What I learned was not just technical stuff, but also:

* How to face uncertainty
* How to keep shipping under pressure
* How to admit I am not strong enough yet, while still moving forward

> The road ahead is still long, but at least now I am clearer about what kind of engineer I want to become, and I am less afraid of moving a little slower than everyone else.

— Vic

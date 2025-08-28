---
title: ClickHouse 系列：使用 Kubernates 部署 ClickHouse 分散式架構
published: 2025-09-01
description: ''
image: 'https://images.prismic.io/contrary-research/ZiwDyN3JpQ5PTNpR_clickhousecover.png?auto=format,compress'
tags: [ClickHouse, Database, 鐵人賽, Distributed]
category: 'software development'
draft: false 
lang: ''
---

> 建議使用 unix-alike 實作 (windows 可以使用 WSL2)

## 安裝 minikube
https://minikube.sigs.k8s.io/docs/start/?arch=%2Flinux%2Fx86-64%2Fstable%2Fbinary+download

```bash
minikube start
```


範例：
```bash
vi distributed-clickhouse.yaml
```

```yaml
# ======================
# Namespace
# ======================
apiVersion: v1
kind: Namespace
metadata:
  name: clickhouse-dist
---
# ======================
# Zookeeper Client Service
# ======================
apiVersion: v1
kind: Service
metadata:
  name: zookeeper
  namespace: clickhouse-dist
spec:
  ports:
    - port: 2181
      name: client
  selector:
    app: zookeeper
---
# ======================
# Zookeeper Headless Service
# ======================
apiVersion: v1
kind: Service
metadata:
  name: zookeepers
  namespace: clickhouse-dist
spec:
  clusterIP: None
  ports:
    - port: 2888
      name: server
    - port: 3888
      name: leader-election
  selector:
    app: zookeeper
---
# ======================
# Zookeeper PDB
# ======================
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: zookeeper-pdb
  namespace: clickhouse-dist
spec:
  maxUnavailable: 1
  selector:
    matchLabels:
      app: zookeeper
---
# ======================
# Zookeeper StatefulSet
# ======================
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: zookeeper
  namespace: clickhouse-dist
spec:
  serviceName: zookeepers
  replicas: 3
  selector:
    matchLabels:
      app: zookeeper
  template:
    metadata:
      labels:
        app: zookeeper
    spec:
      containers:
        - name: zookeeper
          image: zookeeper:3.8
          ports:
            - containerPort: 2181
              name: client
            - containerPort: 2888
              name: server
            - containerPort: 3888
              name: leader-election
          env:
            - name: ZOO_MY_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: ZOO_SERVERS
              value: server.1=zookeeper-0.zookeepers.clickhouse-dist.svc.cluster.local:2888:3888;2181 server.2=zookeeper-1.zookeepers.clickhouse-dist.svc.cluster.local:2888:3888;2181 server.3=zookeeper-2.zookeepers.clickhouse-dist.svc.cluster.local:2888:3888;2181
          volumeMounts:
            - name: datadir
              mountPath: /data
      volumes:
        - name: datadir
          emptyDir: {}
---
# ======================
# ClickHouseInstallation
# ======================
apiVersion: "clickhouse.altinity.com/v1"
kind: "ClickHouseInstallation"
metadata:
  name: "distributed-clickhouse"
  namespace: "clickhouse-dist"
spec:
  configuration:
    zookeeper:
      nodes:
        - host: zookeeper.clickhouse-dist
          port: 2181
    clusters:
      - name: "dist-cluster"
        layout:
          shardsCount: 2
          replicasCount: 2
  defaults:
    templates:
      podTemplate: clickhouse-template
  templates:
    podTemplates:
      - name: clickhouse-template
        spec:
          containers:
            - name: clickhouse-pod
              image: clickhouse/clickhouse-server:24.8
```

## 套用 configuration

```bash
kubectl apply -f distributed-clickhouse.yaml
```
```bash
namespace/clickhouse-dist created
service/zookeeper created
service/zookeepers created
poddisruptionbudget.policy/zookeeper-pdb created
statefulset.apps/zookeeper created
clickhouseinstallation.clickhouse.altinity.com/distributed-clickhouse created
```

### 查看 CHI
```bash
kubectl get chi -n clickhouse-dist
```

```bash
NAME                     CLUSTERS   HOSTS   STATUS       HOSTS-COMPLETED   AGE   SUSPEND
distributed-clickhouse   1          4       InProgress   2                 50s
```

### 查看 services
```bash
kubectl get svc -n clickhouse-dist
```

可能要等一下子，五個 service 才會都出現
```bash
NAME                                          TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)                      AGE
chi-distributed-clickhouse-dist-cluster-0-0   ClusterIP   None            <none>        9000/TCP,8123/TCP,9009/TCP   40s
chi-distributed-clickhouse-dist-cluster-0-1   ClusterIP   None            <none>        9000/TCP,8123/TCP,9009/TCP   9s
chi-distributed-clickhouse-dist-cluster-1-0   ClusterIP   None            <none>        9000/TCP,8123/TCP,9009/TCP   40s
chi-distributed-clickhouse-dist-cluster-1-1   ClusterIP   None            <none>        9000/TCP,8123/TCP,9009/TCP   2s
clickhouse-distributed-clickhouse             ClusterIP   None            <none>        8123/TCP,9000/TCP            13s
zookeeper                                     ClusterIP   10.102.43.134   <none>        2181/TCP                     46s
zookeepers                                    ClusterIP   None            <none>        2888/TCP,3888/TCP            46s
```

## 查看 Pods
```bash
kubectl get pods -n clickhouse-dist
```

```bash
NAME                                            READY   STATUS    RESTARTS   AGE
chi-distributed-clickhouse-dist-cluster-0-0-0   1/1     Running   0          81s
chi-distributed-clickhouse-dist-cluster-0-1-0   1/1     Running   0          43s
chi-distributed-clickhouse-dist-cluster-1-0-0   1/1     Running   0          81s
chi-distributed-clickhouse-dist-cluster-1-1-0   1/1     Running   0          36s
```

## 進入 bash 使用
```bash
kubectl -n k8s-clickhouse-distributed exec -it chi-distributed-clickhouse-dist-cluster-0-0-0 -- clickhouse-client
```

```sql
CREATE DATABASE demo ON CLUSTER '{cluster}';
```

```sql
CREATE TABLE demo.local_visits ON CLUSTER '{cluster}'
(
    id UInt32,
    url String,
    ts DateTime
)
ENGINE = ReplicatedMergeTree()
ORDER BY id;
```

```sql
CREATE TABLE demo.dist_visits
(
    id UInt32,
    url String,
    ts DateTime
)
ENGINE = Distributed('dist-cluster', 'demo', 'local_visits', rand());
```

> 使用一般使用者跑
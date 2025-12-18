### Preview 
![preview]('preview.png')

## 현재 사용 가능한 배포 방법:

### 1. Consul 모드 (로컬 빌드):
./scripts/deploy-remote-sshconfig.sh --host pmx-102-2 --compose-rel etc/docker/docker-compose.consul.yml --skip-build

### 2. 이미 배포된 상태이므로, 재시작만 필요하면:
ssh pmx-102-2 "cd ~/NewsInsight/etc/docker && docker compose -f docker-compose.consul.yml up -d"

### 3. 코드 변경 후 재빌드 배포:
rsync -avz --exclude='.git' --exclude='node_modules' /home/nodove/workspace/NewsInsight/ pmx-102-2:~/NewsInsight/
ssh pmx-102-2 "cd ~/NewsInsight/etc/docker && docker compose -f docker-compose.consul.yml up -d --build"

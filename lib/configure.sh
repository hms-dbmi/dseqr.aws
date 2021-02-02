cd /home/ubuntu

# install Docker
apt-get remove docker docker-engine docker.io containerd runc
apt-get update
apt-get install apt-transport-https ca-certificates curl gnupg-agent software-properties-common -y
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add -
apt-key fingerprint 0EBFCD88
add-apt-repository    "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) \
    stable"
apt-get update
apt-get install docker-ce docker-ce-cli containerd.io -y
docker run hello-world

# pull drugseqr
docker pull alexvpickering/drugseqr
docker network create sp-example-net

# get Dockerfile for ShinyProxy image
mkdir drugseqr.sp
cd drugseqr.sp
wget https://raw.githubusercontent.com/hms-dbmi/drugseqr.sp/master/Dockerfile

# customize application.yml before building based on the name of your app/authentication/etc.
# app.html fixes mobile bootstrap breakpoints (shinyproxy#96)
wget https://raw.githubusercontent.com/hms-dbmi/drugseqr.sp/master/application.yml
wget https://raw.githubusercontent.com/hms-dbmi/drugseqr.sp/master/app.html
wget https://raw.githubusercontent.com/hms-dbmi/drugseqr.sp/master/login.html

# modify application.yml to use cognito
# replacement variables have to be set e.g. in user data
if ["$USE_COGNITO" = true]; then
  sed -i "s/# /" application.yml # uncomment single comments
  sed -i "s/authentication: none/authentication: openid" application.yml
  sed -i "s/{region}/$REGION/" application.yml
  sed -i "s/{userPoolId}/$USER_POOL_ID/" application.yml
  sed -i "s/{cognito_domain_prefix}/$COGNITO_DOMAIN/" application.yml
  sed -i "s/{client_id}/$CLIENT_ID/" application.yml
  sed -i "s/{your_host_url}/$HOST_URL/" application.yml
  sed -i "s/client-id:/client-id: $CLIENT_ID/" application.yml
  sed -i "s/client-secret:/client-secret: $CLIENT_SECRET/" application.yml
fi

docker build -t drugseqr.sp .

# install nginx
apt install nginx -y
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable

# setup nginx
cd /etc/nginx/sites-available
wget -O drugseqr.com https://raw.githubusercontent.com/hms-dbmi/drugseqr.sp/master/nginx.conf

# if e.g. launching at drugseqr.com
sed -i 's/localhost/drugseqr.com www.drugseqr.com/' drugseqr.com

# if e.g. launching with sjia data
# sed -i 's/example/sjia/' drugseqr.com

ln -s /etc/nginx/sites-available/drugseqr.com /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
systemctl restart nginx

# setup ssl
# apt-get install certbot -y
# apt-get install python-certbot-nginx -y
# certbot --non-interactive --nginx \
#  -d drugseqr.com -d www.drugseqr.com \
#  --agree-tos -m alexvpickering@gmail.com


# init example app
docker run --rm \
  -v /srv/drugseqr:/srv/drugseqr \
  alexvpickering/drugseqr R -e "drugseqr::init_drugseqr('example')"

# get data for example app
cd /srv/drugseqr/
rm -rf example
if [ ! -f example_data.tar.gz ]; then
  wget https://drugseqr.s3.us-east-2.amazonaws.com/example_data.tar.gz
  tar -xzvf example_data.tar.gz
  rm example_data.tar.gz
fi


# run app
docker run -d --restart always \
 -v /var/run/docker.sock:/var/run/docker.sock \
 --net sp-example-net \
  -p 8080:8080 \
   drugseqr.sp
# -*- mode: ruby -*-
# vi: set ft=ruby :

# All Vagrant configuration is done below. The "2" in Vagrant.configure
# configures the configuration version (we support older styles for
# backwards compatibility). Please don't change it unless you know what
# you're doing.
Vagrant.configure("2") do |config|
  # The most common configuration options are documented and commented below.
  # For a complete reference, please see the online documentation at
  # https://docs.vagrantup.com.

  # Every Vagrant development environment requires a box. You can search for
  # boxes at https://atlas.hashicorp.com/search.
  config.vm.box = "ubuntu/trusty64"
  config.vm.network "forwarded_port", guest: 4000, host: 4000
  config.vm.provision :shell, privileged: false, inline: <<-SHELL

    ##########################################
    #                                        #
    # Checking and installing prerequisites  #
    #                                        #
    ##########################################

    # Variables and arrays declarations
    log="ark-install.log"

    sudo apt-get update
    echo -e "Installing tools... "
    sudo apt-get install -yyq build-essential wget python git curl jq htop nmon iftop

    if [ $(dpkg-query -W -f='${Status}' postgresql 2>/dev/null | grep -c "ok installed") -eq 0 ];
    then
      echo -e "Installing postgresql... "
      sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt/ `lsb_release -cs`-pgdg main" >> /etc/apt/sources.list.d/pgdg.list'
      wget -q https://www.postgresql.org/media/keys/ACCC4CF8.asc -O - | sudo apt-key add -
      sudo apt-get update
      sudo apt-get install -yyq postgresql postgresql-contrib libpq-dev
    else
      echo -e "Postgresql is already installed."
    fi

    if ! sudo pgrep -x "ntpd" > /dev/null; then
        echo -e "No NTP found. Installing... "
        sudo apt-get install ntp -yyq &>> $log
        sudo service ntp stop &>> $log
        sudo ntpd -gq &>> $log
        sudo service ntp start &>> $log
        if ! sudo pgrep -x "ntpd" > /dev/null; then
          echo -e "NTP failed to start! It should be installed and running for ARK.\n Check /etc/ntp.conf for any issues and correct them first! \n Exiting."
          exit 1
        fi
        echo -e "NTP was successfuly installed and started with PID:" `grep -x "ntpd"`
    else echo "NTP is up and running with PID:" `pgrep -x "ntpd"`

    fi # if sudo pgrep

    echo "-------------------------------------------------------------------"

    # Installing node
    curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash -
    sudo apt-get install nodejs
    sudo npm install -g n

    sudo n 6.9.1
    sudo npm install forever -g

    echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p

    # Creating DB and user
    sudo -u postgres psql -c "CREATE USER $USER WITH PASSWORD 'password';"
    #sudo -u postgres createuser --createdb --password $USER
    sudo -u postgres createdb -O $USER ark_testnet
    sudo service postgresql start

    git clone https://github.com/arkecosystem/ark-node.git

    cd /home/vagrant/ark-node
    #rm -fr node_modules
    npm install grunt-cli
    npm install
    forever app.js --genesis genesisBlock.testnet.json --config config.testnet.json
  SHELL

  config.vm.provider "virtualbox" do |v|
    v.memory = 1024
    v.customize ["modifyvm", :id, "--cpuexecutioncap", "50"]
    v.name = "ark_node_vm"
  end

  # Disable automatic box update checking. If you disable this, then
  # boxes will only be checked for updates when the user runs
  # `vagrant box outdated`. This is not recommended.
  # config.vm.box_check_update = false

  # Create a forwarded port mapping which allows access to a specific port
  # within the machine from a port on the host machine. In the example below,
  # accessing "localhost:8080" will access port 80 on the guest machine.
  # config.vm.network "forwarded_port", guest: 80, host: 8080

  # Create a private network, which allows host-only access to the machine
  # using a specific IP.
  # config.vm.network "private_network", ip: "192.168.33.10"

  # Create a public network, which generally matched to bridged network.
  # Bridged networks make the machine appear as another physical device on
  # your network.
  # config.vm.network "public_network"

  # Share an additional folder to the guest VM. The first argument is
  # the path on the host to the actual folder. The second argument is
  # the path on the guest to mount the folder. And the optional third
  # argument is a set of non-required options.
  # config.vm.synced_folder "../data", "/vagrant_data"

  # Provider-specific configuration so you can fine-tune various
  # backing providers for Vagrant. These expose provider-specific options.
  # Example for VirtualBox:
  #
  # config.vm.provider "virtualbox" do |vb|
  #   # Display the VirtualBox GUI when booting the machine
  #   vb.gui = true
  #
  #   # Customize the amount of memory on the VM:
  #   vb.memory = "1024"
  # end
  #
  # View the documentation for the provider you are using for more
  # information on available options.

  # Define a Vagrant Push strategy for pushing to Atlas. Other push strategies
  # such as FTP and Heroku are also available. See the documentation at
  # https://docs.vagrantup.com/v2/push/atlas.html for more information.
  # config.push.define "atlas" do |push|
  #   push.app = "YOUR_ATLAS_USERNAME/YOUR_APPLICATION_NAME"
  # end

  # Enable provisioning with a shell script. Additional provisioners such as
  # Puppet, Chef, Ansible, Salt, and Docker are also available. Please see the
  # documentation for more information about their specific syntax and use.
  # config.vm.provision "shell", inline: <<-SHELL
  #   apt-get update
  #   apt-get install -y apache2
  # SHELL
end
